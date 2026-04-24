import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { listMcpToolNames } from "../src/mcp/server.js";

const expectedToolNames = [
  "omg.auth.context",
  "omg.doctor",
  "omg.approvals.list",
  "omg.budget.audit",
  "omg.approve",
  "omg.reject",
  "omg.deploy",
  "omg.init",
  "omg.link",
  "omg.firestore.audit",
  "omg.secret.list",
  "omg.secret.set",
  "omg.secret.delete",
  "omg.project.audit",
  "omg.project.cleanup",
  "omg.project.delete",
  "omg.project.undelete",
  "omg.iam.audit",
  "omg.security.audit",
  "omg.sql.audit",
  "omg.storage.audit",
  "omg.mcp.gateway.audit",
  "omg.mcp.gateway.call",
];

describe("MCP server tool registry", () => {
  it("exposes the expected 23 tools", () => {
    expect(listMcpToolNames()).toEqual(expectedToolNames);
  });

  it("lists the expected tools through the stdio MCP server command", async () => {
    const client = new Client(
      { name: "omg-mcp-smoke-test", version: "0.1.0" },
      { capabilities: {} },
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        path.resolve("node_modules/tsx/dist/cli.mjs"),
        path.resolve("src/cli/index.ts"),
        "mcp",
        "start",
      ],
      cwd: path.resolve("."),
      stderr: "pipe",
    });

    await client.connect(transport);
    try {
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name)).toEqual(expectedToolNames);
    } finally {
      await client.close();
    }
  }, 20_000);
});
