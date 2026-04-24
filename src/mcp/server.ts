import readline from "node:readline";
import { authContextTool, handleAuthContext } from "./tools/auth.js";
import { approveTool, handleApprove } from "./tools/approve.js";
import { approvalsListTool, handleApprovalsList } from "./tools/approvals-list.js";
import { budgetAuditTool, handleBudgetAudit } from "./tools/budget.js";
import { deployTool, handleDeploy } from "./tools/deploy.js";
import { doctorTool, handleDoctor } from "./tools/doctor.js";
import { firestoreAuditTool, handleFirestoreAudit } from "./tools/firestore.js";
import { iamAuditTool, handleIamAudit } from "./tools/iam.js";
import { initTool, handleInit } from "./tools/init.js";
import { linkTool, handleLink } from "./tools/link.js";
import {
  handleProjectAudit,
  handleProjectCleanup,
  handleProjectDelete,
  handleProjectUndelete,
  projectAuditTool,
  projectCleanupTool,
  projectDeleteTool,
  projectUndeleteTool,
} from "./tools/project.js";
import { rejectTool, handleReject } from "./tools/reject.js";
import {
  handleSecretDelete,
  handleSecretList,
  handleSecretSet,
  secretDeleteTool,
  secretListTool,
  secretSetTool,
} from "./tools/secret.js";
import { securityAuditTool, handleSecurityAudit } from "./tools/security.js";
import type { OmgResponse } from "./tools/types.js";

const tools = [
  authContextTool,
  doctorTool,
  approvalsListTool,
  budgetAuditTool,
  approveTool,
  rejectTool,
  deployTool,
  initTool,
  linkTool,
  firestoreAuditTool,
  secretListTool,
  secretSetTool,
  secretDeleteTool,
  projectAuditTool,
  projectCleanupTool,
  projectDeleteTool,
  projectUndeleteTool,
  iamAuditTool,
  securityAuditTool,
];

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
  if (name === authContextTool.name) {
    return handleAuthContext(args ?? {});
  }
  if (name === doctorTool.name) {
    return handleDoctor(args ?? {});
  }
  if (name === approvalsListTool.name) {
    return handleApprovalsList(args ?? {});
  }
  if (name === budgetAuditTool.name) {
    return handleBudgetAudit(args ?? {});
  }
  if (name === approveTool.name) {
    return handleApprove(args ?? {});
  }
  if (name === rejectTool.name) {
    return handleReject(args ?? {});
  }
  if (name === deployTool.name) {
    return handleDeploy(args ?? {});
  }
  if (name === initTool.name) {
    return handleInit(args ?? {});
  }
  if (name === linkTool.name) {
    return handleLink(args ?? {});
  }
  if (name === firestoreAuditTool.name) {
    return handleFirestoreAudit(args ?? {});
  }
  if (name === secretListTool.name) {
    return handleSecretList(args ?? {});
  }
  if (name === secretSetTool.name) {
    return handleSecretSet(args ?? {});
  }
  if (name === secretDeleteTool.name) {
    return handleSecretDelete(args ?? {});
  }
  if (name === projectAuditTool.name) {
    return handleProjectAudit(args ?? {});
  }
  if (name === projectCleanupTool.name) {
    return handleProjectCleanup(args ?? {});
  }
  if (name === projectDeleteTool.name) {
    return handleProjectDelete(args ?? {});
  }
  if (name === projectUndeleteTool.name) {
    return handleProjectUndelete(args ?? {});
  }
  if (name === iamAuditTool.name) {
    return handleIamAudit(args ?? {});
  }
  if (name === securityAuditTool.name) {
    return handleSecurityAudit(args ?? {});
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
