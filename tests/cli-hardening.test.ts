import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { savePlan } from "../src/planner/schema.js";
import { generateDefaultProfile, saveProfile } from "../src/trust/profile.js";
import type { Plan } from "../src/types/plan.js";

const repoRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("init command hardening", () => {
  it("returns a structured validation error in JSON mode when required flags are missing", async () => {
    const cwd = await createTempWorkspace();
    const result = runCli(["init"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      error?: { code: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.command).toBe("init");
    expect(payload.error?.code).toBe("VALIDATION_ERROR");
  });
});

describe("deploy trust gate hardening", () => {
  it("requires --yes in JSON mode for require_confirm actions", async () => {
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "staging");

    const result = runCli(["deploy"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("TRUST_REQUIRES_CONFIRM");
  });

  it("blocks require_approval actions even when --yes is provided", async () => {
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "prod");

    const result = runCli(["deploy", "--yes"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("TRUST_REQUIRES_APPROVAL");
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-cli-hardening-"));
  tempDirs.push(dir);
  return dir;
}

async function writeDeployFixtures(
  cwd: string,
  environment: "staging" | "prod",
): Promise<void> {
  const plan: Plan = {
    version: 1,
    detected: {
      stack: "api-only",
      backend: {
        type: "generic-docker",
        dockerfile: "Dockerfile",
        port: 8080,
      },
    },
    targets: {
      backend: {
        service: "cloud-run",
        serviceName: "demo-api",
        region: "asia-northeast3",
      },
    },
    wiring: [],
    environment: {
      backend: {},
      frontend: {},
    },
    deploymentOrder: ["backend"],
    checks: ["Cloud Run target resolved"],
  };

  const profile = generateDefaultProfile("demo-project", environment);

  await savePlan(cwd, plan);
  await saveProfile(cwd, profile);
}

function runCli(
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; exitCode: number } {
  const tsxCliPath = path.join(
    repoRoot,
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );

  const result = spawnSync(
    process.execPath,
    [
      tsxCliPath,
      path.join(repoRoot, "src", "cli", "index.ts"),
      "--output",
      "json",
      ...args,
    ],
    {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  return {
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    exitCode: result.status ?? 1,
  };
}
