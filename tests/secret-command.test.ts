import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { secretCommand } from "../src/cli/commands/secret.js";
import { setOutputFormat } from "../src/cli/output.js";
import { saveProfile, generateDefaultProfile } from "../src/trust/profile.js";

vi.mock("../src/connectors/secret-manager.js", () => ({
  listSecrets: vi.fn(async () => ({
    projectId: "demo-project",
    secrets: [{ name: "API_KEY", resourceName: "projects/demo-project/secrets/API_KEY" }],
  })),
  setSecret: vi.fn(async () => ({
    projectId: "demo-project",
    name: "API_KEY",
    created: false,
    versionAdded: true,
  })),
}));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe("secret command", () => {
  it("does not require trust confirmation for dry-run secret writes", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await runSecretCli(["set", "API_KEY", "--value", "super-secret-value", "--dry-run"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      data?: Record<string, unknown>;
    };

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("super-secret-value");
  });

  it("requires --yes for dev secret writes in JSON mode", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await runSecretCli(["set", "API_KEY", "--value", "super-secret-value"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
      next?: string[];
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("TRUST_REQUIRES_CONFIRM");
    expect(payload.next).toEqual(["omg secret set API_KEY --yes"]);
    expect(JSON.stringify(payload)).not.toContain("super-secret-value");
  });

  it("sets a secret after trust confirmation without echoing the value", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await runSecretCli(["set", "API_KEY", "--value", "super-secret-value", "--yes"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      data?: Record<string, unknown>;
    };

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("secret:set");
    expect(payload.data).toMatchObject({
      projectId: "demo-project",
      name: "API_KEY",
      versionAdded: true,
    });
    expect(JSON.stringify(payload)).not.toContain("super-secret-value");
  });

  it("lists secrets as metadata only", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await runSecretCli(["list", "--limit", "5"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      data?: { secrets?: unknown[] };
    };

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("secret:list");
    expect(payload.data?.secrets).toHaveLength(1);
  });

  it("honors deny policy for secret metadata listing", async () => {
    const cwd = await createTempWorkspace();
    const profile = generateDefaultProfile("demo-project", "dev");
    profile.deny = ["secret.*"];
    await saveProfile(cwd, profile);

    const result = await runSecretCli(["list"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("TRUST_DENIED");
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-secret-command-"));
  tempDirs.push(dir);
  return dir;
}

async function runSecretCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalCwd = process.cwd;
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;
  let exitCode = 0;

  console.log = (...values: unknown[]) => {
    stdout.push(values.join(" "));
  };
  console.error = (...values: unknown[]) => {
    stderr.push(values.join(" "));
  };
  process.exit = ((code?: string | number | null) => {
    exitCode = typeof code === "number" ? code : 1;
    throw new CliExit(exitCode);
  }) as typeof process.exit;

  try {
    setOutputFormat("json");
    process.cwd = (() => cwd) as typeof process.cwd;
    await secretCommand.parseAsync(args, { from: "user" });
  } catch (error) {
    if (!(error instanceof CliExit)) {
      throw error;
    }
  } finally {
    process.cwd = originalCwd;
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
    setOutputFormat("human");
  }

  return {
    stdout: (stdout[0] ?? "").trim(),
    stderr: stderr.join("\n").trim(),
    exitCode,
  };
}

class CliExit extends Error {
  constructor(public readonly code: number) {
    super("CLI exited");
  }
}
