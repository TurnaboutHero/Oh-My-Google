import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it } from "vitest";
import { approvalsCommand } from "../src/cli/commands/approvals.js";
import { approveCommand } from "../src/cli/commands/approve.js";
import { rejectCommand } from "../src/cli/commands/reject.js";
import { setOutputFormat } from "../src/cli/output.js";
import { loadApproval, saveApproval } from "../src/approval/queue.js";
import type { ApprovalRequest } from "../src/approval/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("approve command", () => {
  it("approves a pending approval", async () => {
    const cwd = await createTempWorkspace();
    const approval = await writeApproval(cwd, { id: "apr_pending" });

    const result = await runCli(["approve", approval.id], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      data: { status: string };
    };
    const stored = await loadApproval(cwd, approval.id);

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.data.status).toBe("approved");
    expect(stored?.status).toBe("approved");
  });

  it("returns not found for a missing approval", async () => {
    const cwd = await createTempWorkspace();

    const result = await runCli(["approve", "apr_missing"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("APPROVAL_NOT_FOUND");
  });

  it("rejects approvals that are already approved", async () => {
    const cwd = await createTempWorkspace();
    const approval = await writeApproval(cwd, {
      id: "apr_approved",
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await runCli(["approve", approval.id], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("APPROVAL_ALREADY_FINALIZED");
  });

  it("expires pending approvals that are past their expiration", async () => {
    const cwd = await createTempWorkspace();
    const approval = await writeApproval(cwd, {
      id: "apr_expired",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const result = await runCli(["approve", approval.id], cwd);
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
});

describe("reject command", () => {
  it("rejects a pending approval", async () => {
    const cwd = await createTempWorkspace();
    const approval = await writeApproval(cwd, { id: "apr_reject" });

    const result = await runCli(["reject", approval.id, "--reason", "not today"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      data: { status: string; reason: string };
    };
    const stored = await loadApproval(cwd, approval.id);

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.data.status).toBe("rejected");
    expect(payload.data.reason).toBe("not today");
    expect(stored?.status).toBe("rejected");
  });
});

describe("approvals list command", () => {
  it("filters approvals by pending status", async () => {
    const cwd = await createTempWorkspace();
    await writeApproval(cwd, { id: "apr_pending_1" });
    await writeApproval(cwd, { id: "apr_pending_2" });
    await writeApproval(cwd, {
      id: "apr_approved_1",
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await runCli(["approvals", "list", "--status", "pending"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      data: { approvals: ApprovalRequest[] };
    };

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.data.approvals).toHaveLength(2);
    expect(payload.data.approvals.map((approval) => approval.status)).toEqual([
      "pending",
      "pending",
    ]);
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-approval-commands-"));
  tempDirs.push(dir);
  return dir;
}

async function writeApproval(
  cwd: string,
  overrides: Partial<ApprovalRequest>,
): Promise<ApprovalRequest> {
  const now = new Date();
  const approval: ApprovalRequest = {
    id: "apr_test",
    action: "deploy.cloud-run",
    argsHash: "hash",
    projectId: "demo-project",
    environment: "prod",
    requestedBy: "agent",
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    status: "pending",
    approvedBy: null,
    approvedAt: null,
    reason: null,
    ...overrides,
  };

  await saveApproval(cwd, approval);
  return approval;
}

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const program = new Command();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalCwd = process.cwd;
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;
  let exitCode = 0;

  program.addCommand(approveCommand);
  program.addCommand(rejectCommand);
  program.addCommand(approvalsCommand);

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
    await program.parseAsync(args, { from: "user" });
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
