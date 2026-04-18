import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleDoctor } from "../src/mcp/tools/doctor.js";

const tempDirs: string[] = [];

vi.mock("../src/cli/doctor.js", () => ({
  runDoctor: vi.fn(async () => ({
    ok: false,
    checks: {
      config: { ok: false, detail: "no project configured" },
      adcCredentials: { ok: true, detail: "application default credentials file found" },
    },
    next: ["omg init"],
  })),
}));

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("omg.doctor MCP tool", () => {
  it("returns doctor checks in omg response shape", async () => {
    const cwd = await createTempWorkspace();
    const result = await withCwd(cwd, () => handleDoctor({}));

    expect(typeof result.ok).toBe("boolean");
    expect(result.command).toBe("doctor");
    expect(result.data?.checks).toBeTypeOf("object");
    expect(result.data?.checks).toHaveProperty("config");
    expect(result.data?.checks).toHaveProperty("adcCredentials");

    if (result.next) {
      expect(result.next.every((step) => typeof step === "string")).toBe(true);
    }
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-mcp-doctor-"));
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
