import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDownstreamMcpRegistry } from "../src/downstream-mcp/registry.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("downstream MCP registry", () => {
  it("returns a review warning when .omg/mcp.yaml is missing", async () => {
    const cwd = await createTempWorkspace();

    const registry = await loadDownstreamMcpRegistry(cwd);

    expect(registry).toMatchObject({
      version: 1,
      found: false,
      servers: [],
    });
    expect(registry.warnings[0]).toContain("No downstream MCP registry found");
  });

  it("parses stdio servers and read-only tool allowlists", async () => {
    const cwd = await createTempWorkspace();
    await writeRegistry(cwd, `
version: 1
servers:
  - id: google
    command: node
    args: ["server.js"]
    cwd: tools
    envAllowlist: ["PATH"]
    tools:
      - name: projects.list
        mode: read
        resource: projects
`);

    const registry = await loadDownstreamMcpRegistry(cwd);

    expect(registry.found).toBe(true);
    expect(registry.servers).toEqual([
      {
        id: "google",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        cwd: "tools",
        enabled: true,
        envAllowlist: ["PATH"],
        tools: [
          {
            name: "projects.list",
            mode: "read",
            resource: "projects",
            description: undefined,
            postVerify: undefined,
          },
        ],
      },
    ]);
  });

  it("rejects env value maps so secrets are not stored in the registry", async () => {
    const cwd = await createTempWorkspace();
    await writeRegistry(cwd, `
version: 1
servers:
  - id: google
    command: node
    env:
      TOKEN: secret
`);

    await expect(loadDownstreamMcpRegistry(cwd))
      .rejects
      .toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-mcp-registry-"));
  tempDirs.push(dir);
  return dir;
}

async function writeRegistry(cwd: string, body: string): Promise<void> {
  const filePath = path.join(cwd, ".omg/mcp.yaml");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body.trimStart(), "utf-8");
}
