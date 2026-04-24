import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { ValidationError } from "../types/errors.js";

export const DOWNSTREAM_MCP_CONFIG_PATH = ".omg/mcp.yaml";

export type DownstreamMcpToolMode = "read" | "write" | "lifecycle";

export interface DownstreamMcpToolDeclaration {
  name: string;
  mode: DownstreamMcpToolMode;
  resource?: string;
  description?: string;
  postVerify?: boolean;
}

export interface DownstreamMcpServerConfig {
  id: string;
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  enabled: boolean;
  envAllowlist: string[];
  tools: DownstreamMcpToolDeclaration[];
}

export interface DownstreamMcpRegistry {
  version: 1;
  configPath: string;
  found: boolean;
  servers: DownstreamMcpServerConfig[];
  warnings: string[];
}

export async function loadDownstreamMcpRegistry(
  cwd: string,
  configPath = DOWNSTREAM_MCP_CONFIG_PATH,
): Promise<DownstreamMcpRegistry> {
  const resolvedPath = resolveConfigPath(cwd, configPath);
  try {
    const raw = await fs.readFile(resolvedPath, "utf-8");
    return validateRegistry(parse(raw), resolvedPath);
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        version: 1,
        configPath: resolvedPath,
        found: false,
        servers: [],
        warnings: [`No downstream MCP registry found at ${configPath}.`],
      };
    }
    throw error;
  }
}

export function findServer(
  registry: DownstreamMcpRegistry,
  serverId: string,
): DownstreamMcpServerConfig | undefined {
  return registry.servers.find((server) => server.id === serverId);
}

export function findToolDeclaration(
  server: DownstreamMcpServerConfig,
  toolName: string,
): DownstreamMcpToolDeclaration | undefined {
  return server.tools.find((tool) => tool.name === toolName);
}

export function resolveServerCwd(
  rootCwd: string,
  server: DownstreamMcpServerConfig,
): string | undefined {
  if (!server.cwd) {
    return undefined;
  }

  return path.isAbsolute(server.cwd) ? server.cwd : path.resolve(rootCwd, server.cwd);
}

export function buildAllowedEnvironment(server: DownstreamMcpServerConfig): Record<string, string> | undefined {
  if (server.envAllowlist.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    server.envAllowlist
      .map((name) => [name, process.env[name]])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function validateRegistry(raw: unknown, configPath: string): DownstreamMcpRegistry {
  if (!isRecord(raw)) {
    throw new ValidationError("Downstream MCP registry must be a YAML object.");
  }
  if (raw.version !== 1) {
    throw new ValidationError("Downstream MCP registry version must be 1.");
  }
  if (!Array.isArray(raw.servers)) {
    throw new ValidationError("Downstream MCP registry requires a servers array.");
  }

  const servers = raw.servers.map((entry, index) => validateServer(entry, index));
  const duplicate = findDuplicate(servers.map((server) => server.id));
  if (duplicate) {
    throw new ValidationError(`Downstream MCP server id is duplicated: ${duplicate}.`);
  }

  return {
    version: 1,
    configPath,
    found: true,
    servers,
    warnings: buildRegistryWarnings(servers),
  };
}

function validateServer(raw: unknown, index: number): DownstreamMcpServerConfig {
  if (!isRecord(raw)) {
    throw new ValidationError(`Downstream MCP server at index ${index} must be an object.`);
  }
  if ("env" in raw) {
    throw new ValidationError("Downstream MCP registry must use envAllowlist instead of storing env values.");
  }

  const id = requiredString(raw.id, `servers[${index}].id`);
  if (!/^[a-z][a-z0-9._-]{1,62}$/.test(id)) {
    throw new ValidationError(`Downstream MCP server id is invalid: ${id}.`);
  }

  const transport = raw.transport ?? "stdio";
  if (transport !== "stdio") {
    throw new ValidationError(`Downstream MCP server ${id} uses unsupported transport.`);
  }

  const command = requiredString(raw.command, `servers[${index}].command`);
  const args = optionalStringArray(raw.args, `servers[${index}].args`);
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;
  const envAllowlist = optionalStringArray(raw.envAllowlist, `servers[${index}].envAllowlist`);
  const tools = optionalToolDeclarations(raw.tools, id);
  const duplicate = findDuplicate(tools.map((tool) => tool.name));
  if (duplicate) {
    throw new ValidationError(`Downstream MCP tool declaration is duplicated for ${id}: ${duplicate}.`);
  }

  return {
    id,
    transport,
    command,
    args,
    cwd: optionalString(raw.cwd),
    enabled,
    envAllowlist,
    tools,
  };
}

function optionalToolDeclarations(raw: unknown, serverId: string): DownstreamMcpToolDeclaration[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new ValidationError(`Downstream MCP server ${serverId} tools must be an array.`);
  }
  return raw.map((entry, index) => validateToolDeclaration(entry, serverId, index));
}

function validateToolDeclaration(
  raw: unknown,
  serverId: string,
  index: number,
): DownstreamMcpToolDeclaration {
  if (!isRecord(raw)) {
    throw new ValidationError(`Downstream MCP tool ${serverId}[${index}] must be an object.`);
  }

  const name = requiredString(raw.name, `servers.${serverId}.tools[${index}].name`);
  const mode = raw.mode === undefined ? "read" : raw.mode;
  if (mode !== "read" && mode !== "write" && mode !== "lifecycle") {
    throw new ValidationError(`Downstream MCP tool ${serverId}.${name} has invalid mode.`);
  }

  return {
    name,
    mode,
    resource: optionalString(raw.resource),
    description: optionalString(raw.description),
    postVerify: typeof raw.postVerify === "boolean" ? raw.postVerify : undefined,
  };
}

function buildRegistryWarnings(servers: DownstreamMcpServerConfig[]): string[] {
  const warnings: string[] = [];
  for (const server of servers) {
    if (!server.enabled) {
      warnings.push(`Downstream MCP server ${server.id} is disabled.`);
    }
    if (server.tools.length === 0) {
      warnings.push(`Downstream MCP server ${server.id} has no tool allowlist.`);
    }
    for (const tool of server.tools) {
      if (tool.mode !== "read" && !tool.postVerify) {
        warnings.push(`Downstream MCP tool ${server.id}.${tool.name} is non-read and has no postVerify marker.`);
      }
    }
  }
  return warnings;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${label} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ValidationError(`${label} must be an array.`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new ValidationError(`${label}[${index}] must be a string.`);
    }
    return entry;
  });
}

function findDuplicate(values: string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return undefined;
}

function resolveConfigPath(cwd: string, configPath: string): string {
  return path.isAbsolute(configPath) ? configPath : path.resolve(cwd, configPath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
