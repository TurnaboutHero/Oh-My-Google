import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { loadApproval, saveApproval } from "../../approval/queue.js";
import { createRunId, tryAppendDecision } from "../../harness/decision-log.js";
import { fail, success } from "../output.js";
import type { ApproveError } from "./approve.js";

export interface RejectPayload {
  id: string;
  status: "rejected";
  reason: string | null;
  approvedBy: string;
  approvedAt: string;
}

export type RejectOutcome =
  | { ok: true; data: RejectPayload }
  | { ok: false; error: ApproveError };

export interface RunRejectInput {
  cwd: string;
  approvalId: string;
  reason?: string;
  rejecter?: string;
}

export const rejectCommand = new Command("reject")
  .description("Reject a pending manual approval request")
  .argument("<approvalId>", "Approval request ID")
  .option("--reason <text>", "Rejection reason")
  .action(async (approvalId: string, opts: { reason?: string }) => {
    const outcome = await runReject({ cwd: process.cwd(), approvalId, reason: opts.reason });
    if (!outcome.ok) {
      const data =
        outcome.error.code === "APPROVAL_ALREADY_FINALIZED"
          ? { status: outcome.error.status }
          : undefined;
      fail(
        "reject",
        outcome.error.code,
        outcome.error.message,
        false,
        undefined,
        data,
      );
      process.exit(1);
    }

    success("reject", `Rejected ${outcome.data.id}.`, { ...outcome.data });
  });

export async function runReject(input: RunRejectInput): Promise<RejectOutcome> {
  const runId = createRunId("reject");
  const approval = await loadApproval(input.cwd, input.approvalId);
  if (!approval) {
    const outcome: RejectOutcome = {
      ok: false,
      error: {
        code: "APPROVAL_NOT_FOUND",
        message: `Approval ${input.approvalId} was not found.`,
      },
    };
    await tryAppendDecision(input.cwd, {
      runId,
      command: "reject",
      phase: "approval",
      status: "failure",
      approvalId: input.approvalId,
      result: outcome.error,
    });
    return outcome;
  }

  if (approval.status !== "pending") {
    const outcome: RejectOutcome = {
      ok: false,
      error: {
        code: "APPROVAL_ALREADY_FINALIZED",
        message: `Approval ${approval.id} is already ${approval.status}.`,
        status: approval.status,
      },
    };
    await tryAppendDecision(input.cwd, {
      runId,
      command: "reject",
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
    const outcome: RejectOutcome = {
      ok: false,
      error: {
        code: "APPROVAL_EXPIRED",
        message: `Approval ${approval.id} has expired.`,
      },
    };
    await tryAppendDecision(input.cwd, {
      runId,
      command: "reject",
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

  const approvedBy = input.rejecter ?? getRejecter();
  const approvedAt = new Date().toISOString();
  const reason = input.reason ?? null;
  await saveApproval(input.cwd, {
    ...approval,
    status: "rejected",
    approvedBy,
    approvedAt,
    reason,
  });

  const outcome: RejectOutcome = {
    ok: true,
    data: {
      id: approval.id,
      status: "rejected",
      reason,
      approvedBy,
      approvedAt,
    },
  };
  await tryAppendDecision(input.cwd, {
    runId,
    command: "reject",
    phase: "approval",
    status: "success",
    action: approval.action,
    projectId: approval.projectId,
    environment: approval.environment,
    approvalId: approval.id,
    result: outcome.data,
  });
  return outcome;
}

function getRejecter(): string {
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
