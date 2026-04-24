import { describe, expect, it, vi } from "vitest";
import {
  handleMcpGatewayAudit,
  handleMcpGatewayCall,
} from "../src/mcp/tools/mcp-gateway.js";

vi.mock("../src/cli/commands/mcp.js", () => ({
  runMcpGatewayAudit: vi.fn(async () => ({
    ok: true,
    data: {
      found: false,
      servers: [],
      warnings: ["No downstream MCP registry found at .omg/mcp.yaml."],
      risk: "review",
    },
    next: ["create .omg/mcp.yaml with explicit downstream server and read-only tool allowlists"],
  })),
  runMcpGatewayCall: vi.fn(async () => ({
    ok: true,
    data: {
      serverId: "google",
      toolName: "projects.list",
      mode: "read",
      result: { content: [] },
    },
  })),
}));

describe("omg.mcp.gateway MCP tools", () => {
  it("returns downstream MCP audit output", async () => {
    const result = await handleMcpGatewayAudit({ discover: false });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("mcp:gateway:audit");
    expect(result.data?.risk).toBe("review");
  });

  it("returns downstream MCP call output", async () => {
    const result = await handleMcpGatewayCall({
      server: "google",
      tool: "projects.list",
      arguments: {},
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("mcp:gateway:call");
    expect(result.data?.toolName).toBe("projects.list");
  });

  it("rejects unknown call arguments", async () => {
    const result = await handleMcpGatewayCall({
      server: "google",
      tool: "projects.list",
      nope: true,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});
