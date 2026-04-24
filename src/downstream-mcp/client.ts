import {
  buildAllowedEnvironment,
  resolveServerCwd,
  type DownstreamMcpServerConfig,
} from "./registry.js";

export interface DownstreamMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface DownstreamMcpClient {
  listTools(): Promise<DownstreamMcpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export type DownstreamMcpClientFactory = (
  server: DownstreamMcpServerConfig,
  cwd: string,
) => Promise<DownstreamMcpClient>;

export const createSdkDownstreamMcpClient: DownstreamMcpClientFactory = async (server, cwd) => {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
  ]);
  const client = new Client({ name: "oh-my-google-gateway", version: "0.1.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    cwd: resolveServerCwd(cwd, server),
    env: buildAllowedEnvironment(server),
    stderr: "pipe",
  });

  await client.connect(transport);

  return {
    async listTools(): Promise<DownstreamMcpTool[]> {
      const result = await client.listTools();
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
        annotations: tool.annotations
          ? {
              readOnlyHint: tool.annotations.readOnlyHint,
              destructiveHint: tool.annotations.destructiveHint,
              idempotentHint: tool.annotations.idempotentHint,
              openWorldHint: tool.annotations.openWorldHint,
            }
          : undefined,
      }));
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      return client.callTool({ name, arguments: args });
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
};
