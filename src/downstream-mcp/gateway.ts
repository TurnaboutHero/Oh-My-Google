import { createRunId, tryAppendDecision } from "../harness/decision-log.js";
import { evaluateSafety } from "../safety/decision.js";
import { classifyOperation } from "../safety/intent.js";
import { loadProfile } from "../trust/profile.js";
import { OmgError, ValidationError } from "../types/errors.js";
import type { TrustProfile } from "../types/trust.js";
import {
  createSdkDownstreamMcpClient,
  type DownstreamMcpClientFactory,
  type DownstreamMcpTool,
} from "./client.js";
import {
  findServer,
  findToolDeclaration,
  loadDownstreamMcpRegistry,
  type DownstreamMcpRegistry,
  type DownstreamMcpServerConfig,
  type DownstreamMcpToolDeclaration,
} from "./registry.js";

export interface DownstreamMcpAuditInput {
  cwd: string;
  config?: string;
  discover?: boolean;
  clientFactory?: DownstreamMcpClientFactory;
}

export interface DownstreamMcpCallInput {
  cwd: string;
  config?: string;
  server: string;
  tool: string;
  arguments?: Record<string, unknown>;
  clientFactory?: DownstreamMcpClientFactory;
}

export interface DownstreamMcpAudit {
  configPath: string;
  found: boolean;
  discovery: boolean;
  servers: DownstreamMcpServerAudit[];
  warnings: string[];
  risk: "low" | "review";
  recommendedAction: string;
}

export interface DownstreamMcpServerAudit {
  id: string;
  enabled: boolean;
  transport: "stdio";
  command: string;
  declaredToolCount: number;
  discoveredToolCount?: number;
  tools: DownstreamMcpToolAudit[];
  warnings: string[];
}

export interface DownstreamMcpToolAudit {
  name: string;
  declared: boolean;
  discovered: boolean;
  mode?: DownstreamMcpToolDeclaration["mode"];
  executable: boolean;
  reason: string;
  mutationSignals: string[];
  resource?: string;
  description?: string;
}

export interface DownstreamMcpCallResult {
  serverId: string;
  toolName: string;
  mode: "read";
  result: unknown;
}

export async function auditDownstreamMcp(input: DownstreamMcpAuditInput): Promise<DownstreamMcpAudit> {
  const registry = await loadDownstreamMcpRegistry(input.cwd, input.config);
  const clientFactory = input.clientFactory ?? createSdkDownstreamMcpClient;
  const serverAudits = await Promise.all(
    registry.servers.map((server) =>
      input.discover
        ? auditServerWithDiscovery(registry, server, input.cwd, clientFactory)
        : auditServerFromRegistry(server),
    ),
  );
  const warnings = [
    ...registry.warnings,
    ...serverAudits.flatMap((server) => server.warnings),
  ];
  const risk = warnings.length > 0 || serverAudits.some((server) => server.tools.some((tool) => !tool.executable))
    ? "review"
    : "low";

  return {
    configPath: registry.configPath,
    found: registry.found,
    discovery: !!input.discover,
    servers: serverAudits,
    warnings,
    risk,
    recommendedAction: getAuditRecommendation(registry, risk),
  };
}

export async function callDownstreamMcp(input: DownstreamMcpCallInput): Promise<DownstreamMcpCallResult> {
  const runId = createRunId("mcp_gateway_call");
  const safeInputs = {
    serverId: input.server,
    toolName: input.tool,
    argumentKeys: Object.keys(input.arguments ?? {}).sort(),
  };

  try {
    const profile = await resolveProfile(input.cwd);
    const registry = await loadDownstreamMcpRegistry(input.cwd, input.config);
    const server = findServer(registry, input.server);
    if (!server) {
      await logBlocked(input.cwd, runId, profile, safeInputs, "DOWNSTREAM_MCP_SERVER_NOT_FOUND");
      throw new OmgError(`Downstream MCP server is not registered: ${input.server}.`, "DOWNSTREAM_MCP_SERVER_NOT_FOUND", false);
    }
    if (!server.enabled) {
      await logBlocked(input.cwd, runId, profile, safeInputs, "DOWNSTREAM_MCP_SERVER_DISABLED");
      throw new OmgError(`Downstream MCP server is disabled: ${input.server}.`, "DOWNSTREAM_MCP_SERVER_DISABLED", false);
    }

    const declaration = findToolDeclaration(server, input.tool);
    const declarationBlock = getDeclarationBlock(server, input.tool, declaration);
    if (declarationBlock) {
      await logBlocked(input.cwd, runId, profile, safeInputs, declarationBlock.code);
      throw new OmgError(declarationBlock.message, declarationBlock.code, declarationBlock.recoverable);
    }

    const safety = await evaluateSafety(
      classifyOperation("downstream.mcp.read", {
        projectId: profile.projectId,
        resource: declaration?.resource ?? `${server.id}/${input.tool}`,
      }),
      profile,
      {
        cwd: input.cwd,
        jsonMode: true,
        yes: true,
      },
    );
    if (!safety.allowed) {
      await logBlocked(input.cwd, runId, profile, safeInputs, safety.code);
      throw new OmgError(safety.reason ?? "Downstream MCP read was blocked by the safety layer.", safety.code, false);
    }

    const clientFactory = input.clientFactory ?? createSdkDownstreamMcpClient;
    const client = await clientFactory(server, input.cwd);
    try {
      const tools = await client.listTools();
      const discovered = tools.find((tool) => tool.name === input.tool);
      const discoveryBlock = getDiscoveryBlock(server, input.tool, declaration, discovered);
      if (discoveryBlock) {
        await logBlocked(input.cwd, runId, profile, safeInputs, discoveryBlock.code);
        throw new OmgError(discoveryBlock.message, discoveryBlock.code, discoveryBlock.recoverable);
      }

      const result = await client.callTool(input.tool, input.arguments ?? {});
      await tryAppendDecision(input.cwd, {
        runId,
        command: "mcp:gateway:call",
        phase: "downstream-mcp",
        status: "success",
        action: "downstream.mcp.read",
        projectId: profile.projectId,
        inputs: safeInputs,
        result: { serverId: server.id, toolName: input.tool },
      });

      return {
        serverId: server.id,
        toolName: input.tool,
        mode: "read",
        result,
      };
    } finally {
      await client.close();
    }
  } catch (error) {
    if (error instanceof OmgError) {
      throw error;
    }

    await tryAppendDecision(input.cwd, {
      runId,
      command: "mcp:gateway:call",
      phase: "downstream-mcp",
      status: "failure",
      action: "downstream.mcp.read",
      inputs: safeInputs,
      result: { message: error instanceof Error ? error.message : "Unknown downstream MCP failure." },
    });
    throw error;
  }
}

async function auditServerFromRegistry(server: DownstreamMcpServerConfig): Promise<DownstreamMcpServerAudit> {
  const tools = server.tools.map((tool) => summarizeTool(tool.name, tool, undefined));
  return {
    id: server.id,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command,
    declaredToolCount: server.tools.length,
    tools,
    warnings: server.enabled ? [] : [`Downstream MCP server ${server.id} is disabled.`],
  };
}

async function auditServerWithDiscovery(
  registry: DownstreamMcpRegistry,
  server: DownstreamMcpServerConfig,
  cwd: string,
  clientFactory: DownstreamMcpClientFactory,
): Promise<DownstreamMcpServerAudit> {
  if (!registry.found || !server.enabled) {
    return auditServerFromRegistry(server);
  }

  const client = await clientFactory(server, cwd);
  try {
    const discoveredTools = await client.listTools();
    const discoveredToolNames = new Set(discoveredTools.map((tool) => tool.name));
    const declaredToolNames = new Set(server.tools.map((tool) => tool.name));
    const tools = [
      ...server.tools.map((tool) => summarizeTool(tool.name, tool, discoveredTools.find((entry) => entry.name === tool.name))),
      ...discoveredTools
        .filter((tool) => !declaredToolNames.has(tool.name))
        .map((tool) => summarizeTool(tool.name, undefined, tool)),
    ].sort((a, b) => a.name.localeCompare(b.name));
    const warnings = [
      ...server.tools
        .filter((tool) => !discoveredToolNames.has(tool.name))
        .map((tool) => `Downstream MCP tool ${server.id}.${tool.name} is declared but was not discovered.`),
      ...discoveredTools
        .filter((tool) => !declaredToolNames.has(tool.name))
        .map((tool) => `Downstream MCP tool ${server.id}.${tool.name} is discovered but not allowlisted.`),
    ];

    return {
      id: server.id,
      enabled: server.enabled,
      transport: server.transport,
      command: server.command,
      declaredToolCount: server.tools.length,
      discoveredToolCount: discoveredTools.length,
      tools,
      warnings,
    };
  } finally {
    await client.close();
  }
}

function summarizeTool(
  name: string,
  declaration: DownstreamMcpToolDeclaration | undefined,
  discovered: DownstreamMcpTool | undefined,
): DownstreamMcpToolAudit {
  const mutationSignals = getMutationSignals(declaration, discovered);
  const executable = !!declaration && declaration.mode === "read" && mutationSignals.length === 0 && (!discovered || discovered.name === name);
  return {
    name,
    declared: !!declaration,
    discovered: !!discovered,
    mode: declaration?.mode,
    executable,
    reason: getToolAuditReason(declaration, discovered, mutationSignals),
    mutationSignals,
    resource: declaration?.resource,
    description: discovered?.description ?? declaration?.description,
  };
}

function getDeclarationBlock(
  server: DownstreamMcpServerConfig,
  toolName: string,
  declaration: DownstreamMcpToolDeclaration | undefined,
): { code: string; message: string; recoverable: boolean } | undefined {
  if (!declaration) {
    return {
      code: "DOWNSTREAM_MCP_TOOL_DENIED",
      message: `Downstream MCP tool is not allowlisted: ${server.id}.${toolName}.`,
      recoverable: false,
    };
  }
  if (declaration.mode !== "read") {
    return {
      code: "DOWNSTREAM_MCP_WRITE_NOT_IMPLEMENTED",
      message: `Downstream MCP tool ${server.id}.${toolName} is not read-only; define a verifier before enabling mutation proxying.`,
      recoverable: false,
    };
  }
  return undefined;
}

function getDiscoveryBlock(
  server: DownstreamMcpServerConfig,
  toolName: string,
  declaration: DownstreamMcpToolDeclaration | undefined,
  discovered: DownstreamMcpTool | undefined,
): { code: string; message: string; recoverable: boolean } | undefined {
  if (!discovered) {
    return {
      code: "DOWNSTREAM_MCP_TOOL_NOT_FOUND",
      message: `Downstream MCP tool was allowlisted but not discovered: ${server.id}.${toolName}.`,
      recoverable: true,
    };
  }
  const mutationSignals = getMutationSignals(declaration, discovered);
  if (mutationSignals.length > 0) {
    return {
      code: "DOWNSTREAM_MCP_TOOL_DENIED",
      message: `Downstream MCP tool ${server.id}.${toolName} has mutation signals: ${mutationSignals.join(", ")}.`,
      recoverable: false,
    };
  }
  return undefined;
}

function getMutationSignals(
  declaration: DownstreamMcpToolDeclaration | undefined,
  discovered: DownstreamMcpTool | undefined,
): string[] {
  const signals: string[] = [];
  if (declaration && declaration.mode !== "read") {
    signals.push(`declared ${declaration.mode}`);
  }
  if (discovered?.annotations?.destructiveHint) {
    signals.push("destructiveHint");
  }
  if (/\b(create|update|delete|remove|destroy|write|set|grant|revoke|deploy|undelete|restore|import|export|patch)\b/i.test(discovered?.name ?? "")) {
    signals.push("mutation-like name");
  }
  return signals;
}

function getToolAuditReason(
  declaration: DownstreamMcpToolDeclaration | undefined,
  discovered: DownstreamMcpTool | undefined,
  mutationSignals: string[],
): string {
  if (!declaration) {
    return "Tool is not allowlisted.";
  }
  if (declaration.mode !== "read") {
    return "Only read-only downstream MCP proxying is implemented.";
  }
  if (mutationSignals.length > 0) {
    return "Tool has mutation signals and is denied.";
  }
  if (discovered === undefined) {
    return "Tool is allowlisted; run discovery to verify server metadata.";
  }
  return "Tool is allowlisted for read-only proxying.";
}

function getAuditRecommendation(registry: DownstreamMcpRegistry, risk: DownstreamMcpAudit["risk"]): string {
  if (!registry.found) {
    return "Create .omg/mcp.yaml before routing downstream MCP servers through omg.";
  }
  if (risk === "review") {
    return "Review downstream MCP allowlists before proxying read-only tools.";
  }
  return "Downstream MCP registry contains only read-only allowlisted tools.";
}

async function resolveProfile(cwd: string): Promise<TrustProfile> {
  const profile = await loadProfile(cwd);
  if (!profile) {
    throw new OmgError("No trust profile found. Run 'omg init' first.", "NO_TRUST_PROFILE", false);
  }
  return profile;
}

async function logBlocked(
  cwd: string,
  runId: string,
  profile: TrustProfile | undefined,
  inputs: Record<string, unknown>,
  code: string,
): Promise<void> {
  await tryAppendDecision(cwd, {
    runId,
    command: "mcp:gateway:call",
    phase: "downstream-mcp",
    status: "blocked",
    action: "downstream.mcp.read",
    projectId: profile?.projectId,
    inputs,
    result: { code },
  });
}

export function parseGatewayArgumentsJson(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError("Gateway tool arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}
