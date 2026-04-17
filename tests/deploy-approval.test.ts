import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApproval, loadApproval, saveApproval } from "../src/approval/queue.js";
import { deployCommand } from "../src/cli/commands/deploy.js";
import { setOutputFormat } from "../src/cli/output.js";
import { readDecisionLog } from "../src/harness/decision-log.js";
import { savePlan } from "../src/planner/schema.js";
import { generateDefaultProfile, saveProfile } from "../src/trust/profile.js";
import type { Plan } from "../src/types/plan.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("deploy approval flow", () => {
  it("creates an approval when prod deploy requires manual approval", async () => {
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "prod");

    const result = await runCli(["deploy"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
      data?: { approvalId: string; action: string; expiresAt: string };
      next?: string[];
    };
    const approvalId = payload.data?.approvalId ?? "";
    const approvals = await fs.readdir(path.join(cwd, ".omg", "approvals"));
    const stored = await loadApproval(cwd, approvalId);
    const decisions = await readDecisionLog(cwd);
    const handoff = await fs.readFile(path.join(cwd, ".omg", "handoff.md"), "utf-8");

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("APPROVAL_REQUIRED");
    expect(approvalId).toMatch(/^apr_/);
    expect(payload.next).toContain(`omg approve ${approvalId}`);
    expect(payload.next).toContain(`omg deploy --approval ${approvalId}`);
    expect(approvals).toHaveLength(1);
    expect(stored?.status).toBe("pending");
    expect(stored?.argsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(decisions.at(-1)).toMatchObject({
      command: "deploy",
      phase: "trust",
      status: "pending_approval",
      approvalId,
    });
    expect(handoff).toContain(`approval ${approvalId} for deploy.cloud-run`);
  });

  it("expires an approved approval that is past its expiration", async () => {
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "prod");
    const approval = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args: deployArgs("demo-api"),
      projectId: "demo-project",
      environment: "prod",
      requestedBy: "agent",
      ttlMinutes: -1,
    });
    await saveApproval(cwd, {
      ...approval,
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await runCli(["deploy", "--approval", approval.id], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
    };
    const stored = await loadApproval(cwd, approval.id);

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("APPROVAL_EXPIRED");
    expect(stored?.status).toBe("expired");
  });

  it("rejects an approval when deploy args changed after approval", async () => {
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "prod", "other");
    const approval = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args: deployArgs("demo-api"),
      projectId: "demo-project",
      environment: "prod",
      requestedBy: "agent",
    });
    await saveApproval(cwd, {
      ...approval,
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await runCli(["deploy", "--approval", approval.id], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("APPROVAL_MISMATCH");
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-deploy-approval-"));
  tempDirs.push(dir);
  return dir;
}

async function writeDeployFixtures(
  cwd: string,
  environment: "staging" | "prod",
  serviceName = "demo-api",
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
        serviceName,
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
    warnings: [],
  };

  const profile = generateDefaultProfile("demo-project", environment);

  await savePlan(cwd, plan);
  await saveProfile(cwd, profile);
}

function deployArgs(service: string): Record<string, unknown> {
  return {
    service,
    region: "asia-northeast3",
    image: "Dockerfile",
    port: 8080,
    runtime: "generic-docker",
    envKeys: [],
  };
}

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const [, ...commandArgs] = args;
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
    await deployCommand.parseAsync(commandArgs, { from: "user" });
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
