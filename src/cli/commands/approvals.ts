import { Command } from "commander";
import { listApprovals } from "../../approval/queue.js";
import type { ApprovalListFilter, ApprovalStatus } from "../../approval/types.js";
import { OmgError, ValidationError } from "../../types/errors.js";
import { fail, getOutputFormat, success } from "../output.js";

export const approvalsCommand = new Command("approvals").description(
  "Manage manual approval requests",
);

approvalsCommand
  .command("list")
  .description("List manual approval requests")
  .option("--status <status>", "Filter by approval status")
  .option("--action <action>", "Filter by approval action")
  .action(async (opts: { status?: string; action?: string }) => {
    try {
      const filter = buildFilter(opts);
      const approvals = await listApprovals(process.cwd(), filter);

      if (getOutputFormat() === "json") {
        success("approvals.list", "Approvals loaded.", { approvals });
        return;
      }

      console.log("omg approvals list");
      console.log("");
      if (approvals.length === 0) {
        console.log("no approvals found");
        return;
      }

      for (const approval of approvals) {
        console.log(
          `${approval.id}  ${approval.action}  ${approval.status}  ${approval.environment}  requested=${approval.requestedAt}  expires=${approval.expiresAt}`,
        );
      }
    } catch (error) {
      const omgError =
        error instanceof OmgError
          ? error
          : new ValidationError(
              error instanceof Error ? error.message : "Unknown approvals error.",
            );

      fail("approvals.list", omgError.code, omgError.message, omgError.recoverable);
      process.exit(1);
    }
  });

function buildFilter(opts: { status?: string; action?: string }): ApprovalListFilter {
  const filter: ApprovalListFilter = {};

  if (opts.status) {
    filter.status = validateStatus(opts.status);
  }
  if (opts.action) {
    filter.action = opts.action;
  }

  return filter;
}

function validateStatus(value: string): ApprovalStatus {
  if (
    value === "pending"
    || value === "approved"
    || value === "rejected"
    || value === "consumed"
    || value === "expired"
  ) {
    return value;
  }

  throw new ValidationError(
    "Approval status must be one of pending, approved, rejected, consumed, or expired.",
  );
}
