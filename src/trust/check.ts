import type { PermissionCheck, TrustProfile } from "../types/trust.js";
import { loadApproval, saveApproval } from "../approval/queue.js";
import { getLevel } from "./levels.js";

export interface CheckOptions {
  yes?: boolean;
  jsonMode?: boolean;
  approvalId?: string;
  argsHash?: string;
  activeAccount?: string;
  cwd?: string;
}

export async function checkPermission(
  action: string,
  profile: TrustProfile,
  opts: CheckOptions = {},
): Promise<PermissionCheck> {
  const deniedBy = findDeniedPattern(action, profile.deny ?? []);
  if (deniedBy) {
    return {
      allowed: false,
      action: "deny",
      reason: `Trust profile deny policy blocks ${action} via ${deniedBy}.`,
      reasonCode: "DENIED",
      deniedBy,
    };
  }

  const level = getLevel(action);
  const trustAction = profile.rules[level];

  if (trustAction === "auto") {
    return { allowed: true, action: trustAction };
  }

  if (trustAction === "deny") {
    return {
      allowed: false,
      action: trustAction,
      reason: `Trust profile denies ${action}.`,
      reasonCode: "DENIED",
    };
  }

  if (trustAction === "require_confirm") {
    if (opts.jsonMode && !opts.yes) {
      return {
        allowed: false,
        action: trustAction,
        reason: `Trust profile requires --yes for ${action} in JSON mode.`,
        reasonCode: "REQUIRES_CONFIRM",
      };
    }

    return { allowed: true, action: trustAction };
  }

  if (!opts.approvalId) {
    return {
      allowed: false,
      action: trustAction,
      reason: `Trust profile requires manual approval for ${action}.`,
      reasonCode: "APPROVAL_REQUIRED",
    };
  }

  const cwd = opts.cwd ?? process.cwd();
  const approval = await loadApproval(cwd, opts.approvalId);

  if (!approval) {
    return {
      allowed: false,
      action: trustAction,
      reason: `Approval ${opts.approvalId} was not found.`,
      reasonCode: "APPROVAL_NOT_FOUND",
      approvalId: opts.approvalId,
    };
  }

  if (approval.status === "consumed") {
    return {
      allowed: false,
      action: trustAction,
      reason: `Approval ${approval.id} has already been consumed.`,
      reasonCode: "APPROVAL_CONSUMED",
      approvalId: approval.id,
    };
  }

  if (approval.status !== "approved") {
    return {
      allowed: false,
      action: trustAction,
      reason: `Approval ${approval.id} is not approved.`,
      reasonCode: "APPROVAL_NOT_APPROVED",
      approvalId: approval.id,
    };
  }

  if (approval.action !== action) {
    return {
      allowed: false,
      action: trustAction,
      reason: `Approval ${approval.id} does not match ${action}.`,
      reasonCode: "APPROVAL_MISMATCH",
      approvalId: approval.id,
    };
  }

  if (opts.argsHash && approval.argsHash !== opts.argsHash) {
    return {
      allowed: false,
      action: trustAction,
      reason: `Approval ${approval.id} does not match command arguments.`,
      reasonCode: "APPROVAL_MISMATCH",
      approvalId: approval.id,
    };
  }

  if (approval.requestedAccount && approval.requestedAccount !== opts.activeAccount) {
    return {
      allowed: false,
      action: trustAction,
      reason: opts.activeAccount
        ? `Approval ${approval.id} was created for ${approval.requestedAccount}, but active account is ${opts.activeAccount}.`
        : `Approval ${approval.id} was created for ${approval.requestedAccount}, but active account could not be verified.`,
      reasonCode: "ACCOUNT_MISMATCH",
      approvalId: approval.id,
    };
  }

  if (new Date() > new Date(approval.expiresAt)) {
    await saveApproval(cwd, { ...approval, status: "expired" });
    return {
      allowed: false,
      action: trustAction,
      reason: `Approval ${approval.id} has expired.`,
      reasonCode: "APPROVAL_EXPIRED",
      approvalId: approval.id,
    };
  }

  await saveApproval(cwd, { ...approval, status: "consumed" });

  return { allowed: true, action: trustAction };
}

export { getLevel };

function findDeniedPattern(action: string, patterns: string[]): string | undefined {
  return patterns.find((pattern) => matchesActionPattern(action, pattern));
}

function matchesActionPattern(action: string, pattern: string): boolean {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(action);
}
