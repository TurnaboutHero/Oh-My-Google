import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSecretList, handleSecretSet } from "../src/mcp/tools/secret.js";
import { generateDefaultProfile, saveProfile } from "../src/trust/profile.js";

vi.mock("../src/connectors/secret-manager.js", () => ({
  listSecrets: vi.fn(async () => ({
    projectId: "demo-project",
    secrets: [{ name: "API_KEY", resourceName: "projects/demo-project/secrets/API_KEY" }],
  })),
  setSecret: vi.fn(async (input: { dryRun?: boolean }) =>
    input.dryRun
      ? {
          projectId: "demo-project",
          name: "API_KEY",
          dryRun: true,
          wouldCreateIfMissing: true,
          wouldAddVersion: true,
        }
      : {
          projectId: "demo-project",
          name: "API_KEY",
          created: false,
          versionAdded: true,
        },
  ),
}));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe("omg.secret MCP tools", () => {
  it("lists secret metadata", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await withCwd(cwd, () => handleSecretList({ limit: 5 }));

    expect(result.ok).toBe(true);
    expect(result.command).toBe("secret:list");
    expect(result.data?.secrets).toEqual([
      { name: "API_KEY", resourceName: "projects/demo-project/secrets/API_KEY" },
    ]);
  });

  it("honors deny policy for secret metadata listing", async () => {
    const cwd = await createTempWorkspace();
    const profile = generateDefaultProfile("demo-project", "dev");
    profile.deny = ["secret.*"];
    await saveProfile(cwd, profile);

    const result = await withCwd(cwd, () => handleSecretList({}));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TRUST_DENIED");
  });

  it("dry-runs secret writes without echoing the secret value", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await withCwd(cwd, () =>
      handleSecretSet({
        name: "API_KEY",
        value: "super-secret-value",
        dryRun: true,
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.command).toBe("secret:set");
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
  });

  it("requires yes for dev secret writes", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await withCwd(cwd, () =>
      handleSecretSet({
        name: "API_KEY",
        value: "super-secret-value",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TRUST_REQUIRES_CONFIRM");
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
  });

  it("returns validation errors for unknown arguments", async () => {
    const result = await handleSecretSet({ name: "API_KEY", value: "x", nope: true });

    expect(result.ok).toBe(false);
    expect(result.command).toBe("secret:set");
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-mcp-secret-"));
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
