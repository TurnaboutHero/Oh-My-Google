import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { loadApproval, saveApproval } from "../../approval/queue.js";
import { createRunId, tryAppendDecision } from "../../harness/decision-log.js";
import type { ApprovalStatus } from "../../approval/types.js";
import { fail, success } from "../output.js";

export interface ApprovePayload {
  id: string;
  action: string;
  status: "approved";
  approvedBy: string;
  approvedAt: string;
}

export type ApproveError =
  | { code: "APPROVAL_NOT_FOUND"; message: string }
  | { code: "APPROVAL_ALREADY_FINALIZED"; message: string; status: ApprovalStatus }
  | { code: "APPROVAL_EXPIRED"; message: string };

export type ApproveOutcome =
  | { ok: true; data: ApprovePayload; next: string[] }
  | { ok: false; error: ApproveError };

export interface RunApproveInput {
  cwd: string;
  approvalId: string;
  reason?: string;
  approver?: string;
}

export const approveCommand = new Command("approve")
  .description("Approve a pending manual approval request")
  .argument("<approvalId>", "Approval request ID")
  .option("--reason <text>", "Approval reason")
  .action(async (approvalId: string, opts: { reason?: string }) => {
    const outcome = await runApprove({ cwd: process.cwd(), approvalId, reason: opts.reason });
    if (!outcome.ok) {
      const data =
        outcome.error.code === "APPROVAL_ALREADY_FINALIZED"
          ? { status: outcome.error.status }
          : undefined;
      fail(
        "approve",
        outcome.error.code,
        outcome.error.message,
        false,
        undefined,
        data,
      );
      process.exit(1);
    }

    success(
      "approve",
      `Approved ${outcome.data.id}.`,
      { ...outcome.data },
      outcome.next,
    );
  });

export async function runApprove(input: RunApproveInput): Promise<ApproveOutcome> {
  const runId = createRunId("approve");
  const approval = await loadApproval(input.cwd, input.approvalId);
  if (!approval) {
    const outcome: ApproveOutcome = {
      ok: false,
      error: {
        code: "APPROVAL_NOT_FOUND",
        message: `Approval ${input.approvalId} was not found.`,
      },
    };
    await tryAppendDecision(input.cwd, {
      runId,
      command: "approve",
      phase: "approval",
      status: "failure",
      approvalId: input.approvalId,
      result: outcome.error,
    });
    return outcome;
  }

  if (approval.status !== "pending") {
    const outcome: ApproveOutcome = {
      ok: false,
      error: {
        code: "APPROVAL_ALREADY_FINALIZED",
        message: `Approval ${approval.id} is already ${approval.status}.`,
        status: approval.status,
      },
    };
    await tryAppendDecision(input.cwd, {
      runId,
      command: "approve",
      phase: "approval",
      status: "blocked",
      action: approval.action,
      projectId: approval.projectId,
      environment: approval.environment,
      approvalId: approval.id,
      result: outcome.error,
    });
    return outcome;
  }

  if (new Date() > new Date(approval.expiresAt)) {
    await saveApproval(input.cwd, { ...approval, status: "expired" });
    const outcome: ApproveOutcome = {
      ok: false,
      error: {
        code: "APPROVAL_EXPIRED",
        message: `Approval ${approval.id} has expired.`,
      },
    };
    await tryAppendDecision(input.cwd, {
      runId,
      command: "approve",
      phase: "approval",
      status: "failure",
      action: approval.action,
      projectId: approval.projectId,
      environment: approval.environment,
      approvalId: approval.id,
      result: outcome.error,
    });
    return outcome;
  }

  const approvedBy = input.approver ?? getApprover();
  const approvedAt = new Date().toISOString();
  await saveApproval(input.cwd, {
    ...approval,
    status: "approved",
    approvedBy,
    approvedAt,
    reason: input.reason ?? null,
  });

  const next = getApprovalNext(approval);
  const outcome: ApproveOutcome = {
    ok: true,
    data: {
      id: approval.id,
      action: approval.action,
      status: "approved",
      approvedBy,
      approvedAt,
    },
    next,
  };
  await tryAppendDecision(input.cwd, {
    runId,
    command: "approve",
    phase: "approval",
    status: "success",
    action: approval.action,
    projectId: approval.projectId,
    environment: approval.environment,
    approvalId: approval.id,
    result: outcome.data,
    next,
  });
  return outcome;
}

function getApprovalNext(approval: { action: string; id: string; projectId: string }): string[] {
  if (approval.action === "gcp.project.delete") {
    return [`omg project delete --project ${approval.projectId} --approval ${approval.id}`];
  }
  if (approval.action === "gcp.project.undelete") {
    return [`omg project undelete --project ${approval.projectId} --approval ${approval.id}`];
  }
  return [`omg deploy --approval ${approval.id}`];
}

function getApprover(): string {
  try {
    const email = execFileSync("git", ["config", "user.email"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (email) {
      return email;
    }
  } catch {
  }

  return process.env.USER || process.env.USERNAME || "human";
}
