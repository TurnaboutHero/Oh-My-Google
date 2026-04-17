import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { loadApproval, saveApproval } from "../../approval/queue.js";
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
  | { ok: true; data: ApprovePayload }
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
      [`omg deploy --approval ${outcome.data.id}`],
    );
  });

export async function runApprove(input: RunApproveInput): Promise<ApproveOutcome> {
  const approval = await loadApproval(input.cwd, input.approvalId);
  if (!approval) {
    return {
      ok: false,
      error: {
        code: "APPROVAL_NOT_FOUND",
        message: `Approval ${input.approvalId} was not found.`,
      },
    };
  }

  if (approval.status !== "pending") {
    return {
      ok: false,
      error: {
        code: "APPROVAL_ALREADY_FINALIZED",
        message: `Approval ${approval.id} is already ${approval.status}.`,
        status: approval.status,
      },
    };
  }

  if (new Date() > new Date(approval.expiresAt)) {
    await saveApproval(input.cwd, { ...approval, status: "expired" });
    return {
      ok: false,
      error: {
        code: "APPROVAL_EXPIRED",
        message: `Approval ${approval.id} has expired.`,
      },
    };
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

  return {
    ok: true,
    data: {
      id: approval.id,
      action: approval.action,
      status: "approved",
      approvedBy,
      approvedAt,
    },
  };
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
