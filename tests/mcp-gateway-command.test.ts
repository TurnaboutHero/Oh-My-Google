import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runMcpGatewayAudit,
  runMcpGatewayCall,
} from "../src/cli/commands/mcp.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("mcp gateway command", () => {
  it("returns a registry audit when no downstream config exists", async () => {
    const cwd = await createTempWorkspace();

    const result = await runMcpGatewayAudit({ cwd });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.found : undefined).toBe(false);
    expect(result.ok ? result.next : undefined).toContain(
      "create .omg/mcp.yaml with explicit downstream server and read-only tool allowlists",
    );
  });

  it("validates tool arguments JSON before gateway calls", async () => {
    const cwd = await createTempWorkspace();

    const result = await runMcpGatewayCall({
      cwd,
      server: "google",
      tool: "projects.list",
      argsJson: "[]",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("VALIDATION_ERROR");
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-mcp-command-"));
  tempDirs.push(dir);
  return dir;
}
