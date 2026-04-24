import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditDownstreamMcp,
  callDownstreamMcp,
} from "../src/downstream-mcp/gateway.js";
import { generateDefaultProfile, saveProfile } from "../src/trust/profile.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("downstream MCP stdio integration", () => {
  it("discovers and calls allowlisted tools through the real SDK stdio client", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));
    await writeRegistry(cwd, registryYaml());

    const audit = await auditDownstreamMcp({ cwd, discover: true });

    expect(audit.discovery).toBe(true);
    expect(audit.servers[0]).toMatchObject({
      id: "fixture",
      declaredToolCount: 1,
      discoveredToolCount: 2,
    });
    expect(audit.servers[0].tools.find((tool) => tool.name === "projects.list"))
      .toMatchObject({ declared: true, discovered: true, executable: true });
    expect(audit.servers[0].tools.find((tool) => tool.name === "projects.delete"))
      .toMatchObject({ declared: false, discovered: true, executable: false });

    const result = await callDownstreamMcp({
      cwd,
      server: "fixture",
      tool: "projects.list",
      arguments: {},
    });

    expect(result).toMatchObject({
      serverId: "fixture",
      toolName: "projects.list",
      mode: "read",
    });
    expect(getTextContent(result.result)).toContain("demo-project");
  }, 20_000);

  it("denies unallowlisted stdio tools before downstream execution", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));
    await writeRegistry(cwd, registryYaml());

    await expect(callDownstreamMcp({
      cwd,
      server: "fixture",
      tool: "projects.delete",
      arguments: {},
    })).rejects.toMatchObject({ code: "DOWNSTREAM_MCP_TOOL_DENIED" });
  }, 20_000);
});

function registryYaml(): string {
  const command = yamlString(process.execPath);
  const fixturePath = yamlString(path.resolve("tests/fixtures/downstream-mcp-fixture.mjs"));
  return `
version: 1
servers:
  - id: fixture
    command: ${command}
    args:
      - ${fixturePath}
    tools:
      - name: projects.list
        mode: read
        resource: projects
`;
}

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-mcp-stdio-"));
  tempDirs.push(dir);
  return dir;
}

async function writeRegistry(cwd: string, body: string): Promise<void> {
  const filePath = path.join(cwd, ".omg/mcp.yaml");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body.trimStart(), "utf-8");
}

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/\\/g, "/"));
}

function getTextContent(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return "";
  }
  return result.content
    .filter(isRecord)
    .map((entry) => (typeof entry.text === "string" ? entry.text : ""))
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
