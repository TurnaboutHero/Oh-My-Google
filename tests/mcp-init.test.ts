import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleInit } from "../src/mcp/tools/init.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("omg.init MCP tool", () => {
  it("returns validation error when required arguments are missing", async () => {
    const cwd = await createTempWorkspace();

    const result = await withCwd(cwd, () => handleInit({}));

    expect(result.ok).toBe(false);
    expect(result.command).toBe("init");
    expect(result.error?.code).toBe("VALIDATION_ERROR");
    expect(result.data?.missing).toEqual([
      "projectId",
      "billingAccount",
      "environment",
      "region",
    ]);
  });

  it("returns validation error for an invalid environment", async () => {
    const cwd = await createTempWorkspace();

    const result = await withCwd(cwd, () =>
      handleInit({
        projectId: "demo-project",
        billingAccount: "000000-000000-000000",
        environment: "prod-wrong",
        region: "asia-northeast3",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.command).toBe("init");
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });

  it("returns a structured failure when runtime initialization fails", async () => {
    const cwd = await createTempWorkspace();
    const originalPath = process.env.PATH;
    process.env.PATH = "";

    try {
      const result = await withCwd(cwd, () =>
        handleInit({
          projectId: "demo-project",
          billingAccount: "000000-000000-000000",
          environment: "dev",
          region: "asia-northeast3",
        }),
      );

      expect(result.ok).toBe(false);
      expect(result.command).toBe("init");
      expect(result.error?.code).toBeTruthy();
      expect(result.error?.message).toBeTruthy();
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-mcp-init-"));
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
