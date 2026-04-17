import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthManager } from "../src/auth/auth-manager.js";
import { handleLink } from "../src/mcp/tools/link.js";

vi.mock("../src/planner/gcp-state.js", () => ({
  fetchGcpState: async (projectId: string) => ({
    projectId,
    enabledApis: [],
    cloudRunServices: [],
    firebaseLinked: false,
  }),
}));

const tempDirs: string[] = [];
const originalLoadConfig = AuthManager.loadConfig;

afterEach(async () => {
  AuthManager.loadConfig = originalLoadConfig;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("omg.link MCP tool", () => {
  it("returns no deployable content for an empty cwd", async () => {
    const cwd = await createTempWorkspace();

    const result = await withCwd(cwd, () => handleLink({}));

    expect(result.ok).toBe(false);
    expect(result.command).toBe("link");
    expect(result.error?.code).toBe("NO_DEPLOYABLE_CONTENT");
  });

  it("creates a static site plan for plain HTML", async () => {
    const cwd = await createTempWorkspace();
    await fs.writeFile(path.join(cwd, "index.html"), "<!DOCTYPE html><h1>Hello</h1>", "utf-8");
    AuthManager.loadConfig = async () => ({
      profile: {
        projectId: "demo-project",
        defaultRegion: "asia-northeast3",
      },
    });

    const result = await withCwd(cwd, () => handleLink({ site: "demo-site" }));

    expect(result.ok).toBe(true);
    expect(result.command).toBe("link");
    expect(result.data?.plan).toMatchObject({
      detected: { stack: "static" },
      targets: {
        frontend: {
          service: "firebase-hosting",
          siteName: "demo-site",
        },
      },
    });
    expect(result.next).toContain("omg deploy --dry-run");
  });

  it("returns validation error for invalid arguments", async () => {
    const cwd = await createTempWorkspace();

    const result = await withCwd(cwd, () => handleLink({ region: 123 }));

    expect(result.ok).toBe(false);
    expect(result.command).toBe("link");
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-mcp-link-"));
  tempDirs.push(dir);
  return dir;
}

async function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const originalCwd = process.cwd;
  process.cwd = (() => cwd) as typeof process.cwd;

  try {
    return await fn();
  } finally {
    process.cwd = originalCwd;
  }
}
