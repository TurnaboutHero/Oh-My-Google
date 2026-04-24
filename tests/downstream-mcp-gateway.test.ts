import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  auditDownstreamMcp,
  callDownstreamMcp,
} from "../src/downstream-mcp/gateway.js";
import type { DownstreamMcpClientFactory, DownstreamMcpTool } from "../src/downstream-mcp/client.js";
import { readDecisionLog } from "../src/harness/decision-log.js";
import { generateDefaultProfile, saveProfile } from "../src/trust/profile.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe("downstream MCP gateway", () => {
  it("audits registry-only allowlists without connecting to downstream servers", async () => {
    const cwd = await createTempWorkspace();
    await writeRegistry(cwd, registryYaml());
    const clientFactory = vi.fn<DownstreamMcpClientFactory>();

    const audit = await auditDownstreamMcp({ cwd, clientFactory });

    expect(clientFactory).not.toHaveBeenCalled();
    expect(audit.discovery).toBe(false);
    expect(audit.servers[0].tools).toEqual([
      {
        name: "projects.list",
        declared: true,
        discovered: false,
        mode: "read",
        executable: true,
        reason: "Tool is allowlisted; run discovery to verify server metadata.",
        mutationSignals: [],
        resource: "projects",
        description: undefined,
      },
    ]);
  });

  it("discovers downstream tools and denies unallowlisted tools", async () => {
    const cwd = await createTempWorkspace();
    await writeRegistry(cwd, registryYaml());

    const audit = await auditDownstreamMcp({
      cwd,
      discover: true,
      clientFactory: fakeClientFactory([
        { name: "projects.list", description: "List projects", annotations: { readOnlyHint: true } },
        { name: "projects.delete", description: "Delete a project", annotations: { destructiveHint: true } },
      ]),
    });

    expect(audit.discovery).toBe(true);
    expect(audit.risk).toBe("review");
    expect(audit.servers[0].discoveredToolCount).toBe(2);
    expect(audit.servers[0].tools.find((tool) => tool.name === "projects.list"))
      .toMatchObject({ executable: true, discovered: true });
    expect(audit.servers[0].tools.find((tool) => tool.name === "projects.delete"))
      .toMatchObject({ executable: false, declared: false, reason: "Tool is not allowlisted." });
  });

  it("calls an allowlisted read-only tool and records a decision log event", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));
    await writeRegistry(cwd, registryYaml());
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));

    const result = await callDownstreamMcp({
      cwd,
      server: "google",
      tool: "projects.list",
      arguments: { pageSize: 10 },
      clientFactory: fakeClientFactory([
        { name: "projects.list", annotations: { readOnlyHint: true } },
      ], callTool),
    });

    expect(callTool).toHaveBeenCalledWith("projects.list", { pageSize: 10 });
    expect(result).toMatchObject({
      serverId: "google",
      toolName: "projects.list",
      mode: "read",
    });
    const events = await readDecisionLog(cwd);
    expect(events[0]).toMatchObject({
      command: "mcp:gateway:call",
      phase: "downstream-mcp",
      status: "success",
      action: "downstream.mcp.read",
      projectId: "demo-project",
    });
    expect(events[0].inputs).toEqual({
      serverId: "google",
      toolName: "projects.list",
      argumentKeys: ["pageSize"],
    });
  });

  it("denies unallowlisted tools before calling downstream servers", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));
    await writeRegistry(cwd, registryYaml());
    const callTool = vi.fn();

    await expect(callDownstreamMcp({
      cwd,
      server: "google",
      tool: "projects.delete",
      clientFactory: fakeClientFactory([
        { name: "projects.delete", annotations: { destructiveHint: true } },
      ], callTool),
    })).rejects.toMatchObject({ code: "DOWNSTREAM_MCP_TOOL_DENIED" });

    expect(callTool).not.toHaveBeenCalled();
    const events = await readDecisionLog(cwd);
    expect(events[0]).toMatchObject({
      status: "blocked",
      result: { code: "DOWNSTREAM_MCP_TOOL_DENIED" },
    });
  });

  it("denies non-read declarations until a verifier exists", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));
    await writeRegistry(cwd, `
version: 1
servers:
  - id: google
    command: node
    args: ["server.js"]
    tools:
      - name: projects.delete
        mode: lifecycle
`);

    await expect(callDownstreamMcp({
      cwd,
      server: "google",
      tool: "projects.delete",
      clientFactory: fakeClientFactory([]),
    })).rejects.toMatchObject({ code: "DOWNSTREAM_MCP_WRITE_NOT_IMPLEMENTED" });
  });
});

function fakeClientFactory(
  tools: DownstreamMcpTool[],
  callTool = vi.fn(async () => ({ content: [] })),
): DownstreamMcpClientFactory {
  return vi.fn(async () => ({
    listTools: vi.fn(async () => tools),
    callTool,
    close: vi.fn(async () => undefined),
  }));
}

function registryYaml(): string {
  return `
version: 1
servers:
  - id: google
    command: node
    args: ["server.js"]
    tools:
      - name: projects.list
        mode: read
        resource: projects
`;
}

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-mcp-gateway-"));
  tempDirs.push(dir);
  return dir;
}

async function writeRegistry(cwd: string, body: string): Promise<void> {
  const filePath = path.join(cwd, ".omg/mcp.yaml");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body.trimStart(), "utf-8");
}
