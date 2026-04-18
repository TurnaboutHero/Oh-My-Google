import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadApproval, saveApproval } from "../src/approval/queue.js";
import { projectCommand, runProjectDelete } from "../src/cli/commands/project.js";
import { setOutputFormat } from "../src/cli/output.js";

vi.mock("../src/connectors/project-audit.js", () => ({
  auditProject: vi.fn(async (projectId: string) => ({
    projectId,
    risk: projectId === "quadratic-signifier-fmd0t" ? "do_not_touch" : "review",
    callerRoles: ["roles/owner"],
    billingEnabled: false,
    signals: ["Billing is enabled."],
    recommendedAction: "Do not modify this project until ownership and billing responsibility are confirmed.",
  })),
  buildCleanupPlan: vi.fn((audit: { projectId: string }) => ({
    projectId: audit.projectId,
    dryRun: true,
    allowedToExecute: false,
    steps: ["Review project ownership and enabled APIs in Google Cloud Console."],
    next: ["No automated cleanup command is available."],
  })),
  deleteProject: vi.fn(async (projectId: string) => ({
    projectId,
    lifecycleState: "DELETE_REQUESTED",
  })),
}));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("project command", () => {
  it("returns project audit output in JSON mode", async () => {
    const result = await runProjectCli(["audit", "--project", "quadratic-signifier-fmd0t"]);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      data?: { risk?: string };
    };

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("project:audit");
    expect(payload.data?.risk).toBe("do_not_touch");
  });

  it("returns dry-run cleanup plan only", async () => {
    const result = await runProjectCli(["cleanup", "--project", "citric-optics-380903", "--dry-run"]);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      data?: { allowedToExecute?: boolean; dryRun?: boolean };
    };

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("project:cleanup");
    expect(payload.data?.dryRun).toBe(true);
    expect(payload.data?.allowedToExecute).toBe(false);
  });

  it("rejects cleanup without dry-run", async () => {
    const result = await runProjectCli(["cleanup", "--project", "citric-optics-380903"]);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("VALIDATION_ERROR");
  });

  it("requires approval for project deletion", async () => {
    const result = await runProjectCli(["delete", "--project", "citric-optics-380903"]);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
      data?: { approvalId?: string; action?: string };
      next?: string[];
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("APPROVAL_REQUIRED");
    expect(payload.data?.approvalId).toMatch(/^apr_/);
    expect(payload.data?.action).toBe("gcp.project.delete");
    expect(payload.next?.join(" ")).toContain("omg project delete --project citric-optics-380903 --approval");
  });

  it("blocks protected projects before approval", async () => {
    const result = await runProjectCli(["delete", "--project", "quadratic-signifier-fmd0t"]);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("TRUST_DENIED");
  });

  it("deletes after approval is explicitly approved", async () => {
    const cwd = await createTempWorkspace();
    const pending = await runProjectDelete({
      cwd,
      project: "citric-optics-380903",
      requester: "agent@example.com",
    });
    if (pending.ok) {
      throw new Error("expected pending approval");
    }

    const approvalId = String(pending.error.data?.approvalId);
    const approval = await loadApproval(cwd, approvalId);
    if (!approval) {
      throw new Error("approval not found");
    }
    await saveApproval(cwd, {
      ...approval,
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await runProjectDelete({
      cwd,
      project: "citric-optics-380903",
      approval: approvalId,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.lifecycleState : undefined).toBe("DELETE_REQUESTED");
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-project-delete-"));
  tempDirs.push(dir);
  return dir;
}

async function runProjectCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cwd = await createTempWorkspace();
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
    await projectCommand.parseAsync(args, { from: "user" });
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
