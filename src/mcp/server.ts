import readline from "node:readline";
import { approvalsListTool, handleApprovalsList } from "./tools/approvals-list.js";
import { doctorTool, handleDoctor } from "./tools/doctor.js";
import type { OmgResponse } from "./tools/types.js";

const tools = [doctorTool, approvalsListTool];

export async function startMcpServer(opts: { transport: "stdio" }): Promise<void> {
  if (opts.transport !== "stdio") {
    throw new Error("Only stdio transport is supported.");
  }

  const sdk = await loadMcpSdk();
  if (!sdk) {
    await startLineDelimitedFallback();
    return;
  }

  const server = new sdk.Server(
    { name: "oh-my-google", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(sdk.ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(sdk.CallToolRequestSchema, async (request: McpCallRequest) =>
    toToolResult(await callTool(request.params.name, request.params.arguments)),
  );

  await server.connect(new sdk.StdioServerTransport());
}

async function callTool(name: string, args: unknown): Promise<OmgResponse> {
  if (name === doctorTool.name) {
    return handleDoctor(args ?? {});
  }
  if (name === approvalsListTool.name) {
    return handleApprovalsList(args ?? {});
  }

  return {
    ok: false,
    command: name,
    error: {
      code: "UNKNOWN_TOOL",
      message: `Unknown tool: ${name}`,
      recoverable: false,
    },
  };
}

function toToolResult(response: OmgResponse): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(response) }] };
}

async function loadMcpSdk(): Promise<McpSdk | null> {
  try {
    const importModule = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<Record<string, unknown>>;
    const [serverModule, stdioModule, typesModule] = await Promise.all([
      importModule("@modelcontextprotocol/sdk/server/index.js"),
      importModule("@modelcontextprotocol/sdk/server/stdio.js"),
      importModule("@modelcontextprotocol/sdk/types.js"),
    ]);

    return {
      Server: serverModule.Server as McpSdk["Server"],
      StdioServerTransport: stdioModule.StdioServerTransport as McpSdk["StdioServerTransport"],
      ListToolsRequestSchema: typesModule.ListToolsRequestSchema,
      CallToolRequestSchema: typesModule.CallToolRequestSchema,
    };
  } catch {
    return null;
  }
}

async function startLineDelimitedFallback(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const response = await handleFallbackMessage(trimmed);
    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
}

async function handleFallbackMessage(line: string): Promise<Record<string, unknown> | null> {
  try {
    const message = JSON.parse(line) as JsonRpcRequest;
    if (message.method === "tools/list") {
      return { jsonrpc: "2.0", id: message.id, result: { tools } };
    }
    if (message.method === "tools/call") {
      const result = await callTool(
        String(message.params?.name ?? ""),
        message.params?.arguments ?? {},
      );
      return { jsonrpc: "2.0", id: message.id, result: toToolResult(result) };
    }
    return null;
  } catch {
    return null;
  }
}

interface McpCallRequest {
  params: {
    name: string;
    arguments?: unknown;
  };
}

interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
}

interface McpSdk {
  Server: new (
    info: { name: string; version: string },
    options: { capabilities: { tools: Record<string, unknown> } },
  ) => {
    setRequestHandler(schema: unknown, handler: (request: any) => Promise<any> | any): void;
    connect(transport: unknown): Promise<void>;
  };
  StdioServerTransport: new () => unknown;
  ListToolsRequestSchema: unknown;
  CallToolRequestSchema: unknown;
}

interface JsonRpcRequest {
  id?: string | number | null;
  method?: string;
  params?: {
    name?: unknown;
    arguments?: unknown;
  };
}
