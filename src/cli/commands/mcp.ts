import { Command } from "commander";
import {
  auditDownstreamMcp,
  callDownstreamMcp,
  parseGatewayArgumentsJson,
} from "../../downstream-mcp/gateway.js";
import { startMcpServer } from "../../mcp/server.js";
import { OmgError, ValidationError, type OmgError as OmgErrorType } from "../../types/errors.js";
import { fail, success } from "../output.js";

export type RunMcpGatewayOutcome =
  | { ok: true; data: Record<string, unknown>; next?: string[] }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        recoverable: boolean;
        hint?: string;
        data?: Record<string, unknown>;
        next?: string[];
      };
    };

export const mcpCommand = new Command("mcp").description("Run the omg MCP server");

mcpCommand
  .command("start")
  .description("Start the MCP server over stdio")
  .action(async () => {
    await startMcpServer({ transport: "stdio" });
  });

const gatewayCommand = new Command("gateway")
  .description("Inspect and safely proxy registered downstream MCP servers");

gatewayCommand
  .command("audit")
  .description("Audit .omg/mcp.yaml and optionally discover downstream MCP tools")
  .option("--config <path>", "Path to downstream MCP registry", ".omg/mcp.yaml")
  .option("--discover", "Connect to registered servers and list tools without calling tools")
  .action(async (opts) => {
    const outcome = await runMcpGatewayAudit({
      cwd: process.cwd(),
      config: opts.config as string | undefined,
      discover: !!opts.discover,
    });

    if (outcome.ok) {
      success("mcp:gateway:audit", "Downstream MCP gateway audit complete.", outcome.data, outcome.next);
      return;
    }

    emitOutcomeError("mcp:gateway:audit", outcome.error);
  });

gatewayCommand
  .command("call")
  .description("Call an allowlisted read-only downstream MCP tool")
  .requiredOption("--server <id>", "Registered downstream MCP server id")
  .requiredOption("--tool <name>", "Allowlisted downstream MCP tool name")
  .option("--args-json <json>", "Tool arguments as a JSON object")
  .option("--config <path>", "Path to downstream MCP registry", ".omg/mcp.yaml")
  .action(async (opts) => {
    const outcome = await runMcpGatewayCall({
      cwd: process.cwd(),
      config: opts.config as string | undefined,
      server: String(opts.server),
      tool: String(opts.tool),
      argsJson: opts.argsJson as string | undefined,
    });

    if (outcome.ok) {
      success("mcp:gateway:call", "Downstream MCP tool call complete.", outcome.data, outcome.next);
      return;
    }

    emitOutcomeError("mcp:gateway:call", outcome.error);
  });

mcpCommand.addCommand(gatewayCommand);

mcpCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg mcp start
  omg --output json mcp gateway audit
  omg --output json mcp gateway audit --discover
  omg --output json mcp gateway call --server google --tool projects.list --args-json "{}"
`,
);

export async function runMcpGatewayAudit(input: {
  cwd: string;
  config?: string;
  discover?: boolean;
}): Promise<RunMcpGatewayOutcome> {
  try {
    const audit = await auditDownstreamMcp(input);
    return {
      ok: true,
      data: { ...audit },
      next: getGatewayAuditNext(audit),
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

export async function runMcpGatewayCall(input: {
  cwd: string;
  config?: string;
  server: string;
  tool: string;
  argsJson?: string;
}): Promise<RunMcpGatewayOutcome> {
  try {
    const result = await callDownstreamMcp({
      cwd: input.cwd,
      config: input.config,
      server: input.server,
      tool: input.tool,
      arguments: parseGatewayArgumentsJson(input.argsJson),
    });
    return {
      ok: true,
      data: { ...result },
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

function getGatewayAuditNext(audit: { found?: boolean; risk?: unknown }): string[] {
  if (!audit.found) {
    return ["create .omg/mcp.yaml with explicit downstream server and read-only tool allowlists"];
  }
  if (audit.risk === "review") {
    return ["review .omg/mcp.yaml allowlists before calling downstream MCP tools"];
  }
  return [];
}

function emitOutcomeError(
  command: string,
  error: Extract<RunMcpGatewayOutcome, { ok: false }>["error"],
): never {
  fail(
    command,
    error.code,
    error.message,
    error.recoverable,
    error.hint,
    error.data,
    error.next,
  );
  process.exit(1);
}

function toOutcomeError(error: unknown): Extract<RunMcpGatewayOutcome, { ok: false }>["error"] {
  const omgError = toOmgError(error);
  return {
    code: omgError.code,
    message: omgError.message,
    recoverable: omgError.recoverable,
  };
}

function toOmgError(error: unknown): OmgErrorType {
  if (error instanceof OmgError) {
    return error;
  }

  if (error instanceof SyntaxError) {
    return new ValidationError("Gateway tool arguments must be valid JSON.");
  }

  if (error instanceof Error) {
    return new ValidationError(error.message);
  }

  return new ValidationError("Unknown downstream MCP gateway command error.");
}
