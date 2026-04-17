import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { loadApproval, saveApproval } from "../../approval/queue.js";
import { fail, success } from "../output.js";

export const approveCommand = new Command("approve")
  .description("Approve a pending manual approval request")
  .argument("<approvalId>", "Approval request ID")
  .option("--reason <text>", "Approval reason")
  .action(async (approvalId: string, opts: { reason?: string }) => {
    const approval = await loadApproval(process.cwd(), approvalId);
    if (!approval) {
      fail("approve", "APPROVAL_NOT_FOUND", `Approval ${approvalId} was not found.`, false);
      process.exit(1);
    }

    if (approval.status !== "pending") {
      fail(
        "approve",
        "APPROVAL_ALREADY_FINALIZED",
        `Approval ${approval.id} is already ${approval.status}.`,
        false,
        undefined,
        { status: approval.status },
      );
      process.exit(1);
    }

    if (new Date() > new Date(approval.expiresAt)) {
      await saveApproval(process.cwd(), { ...approval, status: "expired" });
      fail("approve", "APPROVAL_EXPIRED", `Approval ${approval.id} has expired.`, false);
      process.exit(1);
    }

    const approvedBy = getApprover();
    const approvedAt = new Date().toISOString();
    await saveApproval(process.cwd(), {
      ...approval,
      status: "approved",
      approvedBy,
      approvedAt,
      reason: opts.reason ?? null,
    });

    success(
      "approve",
      `Approved ${approval.id}.`,
      {
        id: approval.id,
        action: approval.action,
        status: "approved",
        approvedBy,
        approvedAt,
      },
      [`omg deploy --approval ${approval.id}`],
    );
  });

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
