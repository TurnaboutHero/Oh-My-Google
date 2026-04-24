import {
  runMcpGatewayAudit,
  runMcpGatewayCall,
  type RunMcpGatewayOutcome,
} from "../../cli/commands/mcp.js";
import type { OmgResponse } from "./types.js";

export const mcpGatewayAuditTool = {
  name: "omg.mcp.gateway.audit",
  description: "Audit the downstream MCP registry and optionally discover registered downstream tools.",
  inputSchema: {
    type: "object",
    properties: {
      config: { type: "string" },
      discover: { type: "boolean" },
    },
    additionalProperties: false,
  },
};

export const mcpGatewayCallTool = {
  name: "omg.mcp.gateway.call",
  description: "Call an explicitly allowlisted read-only downstream MCP tool through omg safety checks.",
  inputSchema: {
    type: "object",
    properties: {
      config: { type: "string" },
      server: { type: "string" },
      tool: { type: "string" },
      arguments: { type: "object" },
    },
    required: ["server", "tool"],
    additionalProperties: false,
  },
};

export async function handleMcpGatewayAudit(args: unknown): Promise<OmgResponse> {
  const parsed = parseAuditArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome(
    "mcp:gateway:audit",
    await runMcpGatewayAudit({
      cwd: process.cwd(),
      config: parsed.args.config,
      discover: parsed.args.discover,
    }),
  );
}

export async function handleMcpGatewayCall(args: unknown): Promise<OmgResponse> {
  const parsed = parseCallArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome(
    "mcp:gateway:call",
    await runMcpGatewayCall({
      cwd: process.cwd(),
      config: parsed.args.config,
      server: parsed.args.server,
      tool: parsed.args.tool,
      argsJson: JSON.stringify(parsed.args.arguments ?? {}),
    }),
  );
}

function parseAuditArgs(args: unknown):
  | { ok: true; args: { config?: string; discover?: boolean } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("mcp:gateway:audit", "Arguments must be an object.");
  }
  for (const key of Object.keys(args)) {
    if (key !== "config" && key !== "discover") {
      return validationError("mcp:gateway:audit", `Unknown argument: ${key}.`);
    }
  }
  if (args.config !== undefined && typeof args.config !== "string") {
    return validationError("mcp:gateway:audit", "config must be a string.");
  }
  if (args.discover !== undefined && typeof args.discover !== "boolean") {
    return validationError("mcp:gateway:audit", "discover must be a boolean.");
  }
  return { ok: true, args: { config: args.config, discover: args.discover } };
}

function parseCallArgs(args: unknown):
  | { ok: true; args: { config?: string; server: string; tool: string; arguments?: Record<string, unknown> } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("mcp:gateway:call", "Arguments must be an object.");
  }
  for (const key of Object.keys(args)) {
    if (key !== "config" && key !== "server" && key !== "tool" && key !== "arguments") {
      return validationError("mcp:gateway:call", `Unknown argument: ${key}.`);
    }
  }
  if (args.config !== undefined && typeof args.config !== "string") {
    return validationError("mcp:gateway:call", "config must be a string.");
  }
  if (typeof args.server !== "string") {
    return validationError("mcp:gateway:call", "server is required and must be a string.");
  }
  if (typeof args.tool !== "string") {
    return validationError("mcp:gateway:call", "tool is required and must be a string.");
  }
  if (args.arguments !== undefined && !isRecord(args.arguments)) {
    return validationError("mcp:gateway:call", "arguments must be an object.");
  }
  return {
    ok: true,
    args: {
      config: args.config,
      server: args.server,
      tool: args.tool,
      arguments: args.arguments,
    },
  };
}

function fromOutcome(command: string, outcome: RunMcpGatewayOutcome): OmgResponse {
  if (outcome.ok) {
    return {
      ok: true,
      command,
      data: outcome.data,
      next: outcome.next,
    };
  }

  return {
    ok: false,
    command,
    data: outcome.error.data,
    error: {
      code: outcome.error.code,
      message: outcome.error.message,
      recoverable: outcome.error.recoverable,
      hint: outcome.error.hint,
    },
    next: outcome.error.next,
  };
}

function validationError(command: string, message: string): { ok: false; response: OmgResponse } {
  return {
    ok: false,
    response: {
      ok: false,
      command,
      error: { code: "VALIDATION_ERROR", message, recoverable: true },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
