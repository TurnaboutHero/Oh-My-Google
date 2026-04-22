import type { BillingGuardAudit } from "../connectors/billing-audit.js";
import { checkPermission, type CheckOptions } from "../trust/check.js";
import type { PermissionCheck, TrustProfile } from "../types/trust.js";
import {
  getAdapterCapability,
  type OperationIntent,
} from "./intent.js";

export interface SafetyDecisionOptions extends CheckOptions {
  dryRun?: boolean;
  budgetAudit?: BillingGuardAudit;
  budgetAuditProvider?: (projectId: string) => Promise<BillingGuardAudit>;
}

export interface SafetyDecision {
  allowed: boolean;
  decision: "allow" | "require_confirm" | "require_approval" | "deny" | "blocked";
  code: string;
  intent: OperationIntent;
  reason?: string;
  permission?: PermissionCheck;
  budgetRequired: boolean;
  budgetAudit?: BillingGuardAudit;
  budgetRisk?: BillingGuardAudit["risk"];
  next?: string[];
}

export async function evaluateSafety(
  intent: OperationIntent,
  profile: TrustProfile,
  options: SafetyDecisionOptions = {},
): Promise<SafetyDecision> {
  const adapter = getAdapterCapability(intent.adapter);
  if (adapter.execution !== "enabled") {
    return {
      allowed: false,
      decision: "deny",
      code: "ADAPTER_EXECUTION_DISABLED",
      intent,
      reason: `Adapter ${adapter.id} is ${adapter.execution}.`,
      budgetRequired: false,
    };
  }

  const budgetRequired = intent.requiresBudget && !options.dryRun;
  const permission = await checkPermission(intent.id, profile, {
    ...options,
    consumeApproval: shouldDeferApprovalConsumption(intent, options),
  });

  if (!permission.allowed) {
    return {
      allowed: false,
      decision: mapPermissionDecision(permission),
      code: mapPermissionCode(permission),
      intent,
      reason: permission.reason,
      permission,
      budgetRequired: false,
      next: mapPermissionNext(permission),
    };
  }

  let resolvedBudgetAudit: BillingGuardAudit | undefined;
  if (budgetRequired) {
    resolvedBudgetAudit = options.budgetAudit ?? await readBudgetAudit(intent, options);
    if (!resolvedBudgetAudit) {
      return {
        allowed: false,
        decision: "blocked",
        code: "BUDGET_GUARD_REQUIRED",
        intent,
        reason: `Budget guard evidence is required for ${intent.id}.`,
        permission,
        budgetRequired: true,
        next: intent.projectId ? [`omg budget audit --project ${intent.projectId}`] : undefined,
      };
    }

    if (resolvedBudgetAudit.risk !== "configured") {
      return {
        allowed: false,
        decision: "blocked",
        code: "BUDGET_GUARD_BLOCKED",
        intent,
        reason: resolvedBudgetAudit.recommendedAction,
        permission,
        budgetRequired: true,
        budgetAudit: resolvedBudgetAudit,
        budgetRisk: resolvedBudgetAudit.risk,
        next: [`omg budget audit --project ${resolvedBudgetAudit.projectId}`],
      };
    }

    if (options.approvalId && permission.action === "require_approval") {
      const consumed = await checkPermission(intent.id, profile, {
        ...options,
        consumeApproval: true,
      });
      if (!consumed.allowed) {
        return {
          allowed: false,
          decision: mapPermissionDecision(consumed),
          code: mapPermissionCode(consumed),
          intent,
          reason: consumed.reason,
          permission: consumed,
          budgetRequired: true,
          next: mapPermissionNext(consumed),
        };
      }
    }
  }

  return {
    allowed: true,
    decision: "allow",
    code: "SAFETY_ALLOWED",
    intent,
    permission,
    budgetRequired,
    budgetAudit: resolvedBudgetAudit,
  };
}

async function readBudgetAudit(
  intent: OperationIntent,
  options: SafetyDecisionOptions,
): Promise<BillingGuardAudit | undefined> {
  if (!options.budgetAuditProvider || !intent.projectId) {
    return undefined;
  }
  return options.budgetAuditProvider(intent.projectId);
}

function shouldDeferApprovalConsumption(
  intent: OperationIntent,
  options: SafetyDecisionOptions,
): boolean {
  return !(intent.requiresBudget && !options.dryRun && !!options.approvalId);
}

function mapPermissionDecision(
  permission: PermissionCheck,
): SafetyDecision["decision"] {
  switch (permission.reasonCode) {
    case "REQUIRES_CONFIRM":
      return "require_confirm";
    case "APPROVAL_REQUIRED":
    case "APPROVAL_NOT_FOUND":
    case "APPROVAL_EXPIRED":
    case "APPROVAL_NOT_APPROVED":
    case "APPROVAL_MISMATCH":
    case "ACCOUNT_MISMATCH":
    case "APPROVAL_CONSUMED":
      return "require_approval";
    case "DENIED":
    default:
      return "deny";
  }
}

function mapPermissionCode(permission: PermissionCheck): string {
  switch (permission.reasonCode) {
    case "DENIED":
      return "TRUST_DENIED";
    case "REQUIRES_CONFIRM":
      return "TRUST_REQUIRES_CONFIRM";
    case "APPROVAL_REQUIRED":
      return "APPROVAL_REQUIRED";
    case "APPROVAL_NOT_FOUND":
      return "APPROVAL_NOT_FOUND";
    case "APPROVAL_EXPIRED":
      return "APPROVAL_EXPIRED";
    case "APPROVAL_NOT_APPROVED":
      return "APPROVAL_NOT_APPROVED";
    case "APPROVAL_MISMATCH":
      return "APPROVAL_MISMATCH";
    case "ACCOUNT_MISMATCH":
      return "ACCOUNT_MISMATCH";
    case "APPROVAL_CONSUMED":
      return "APPROVAL_CONSUMED";
    default:
      return "TRUST_DENIED";
  }
}

function mapPermissionNext(permission: PermissionCheck): string[] | undefined {
  if (permission.reasonCode === "APPROVAL_NOT_APPROVED" && permission.approvalId) {
    return [`omg approve ${permission.approvalId}`];
  }
  if (permission.reasonCode === "REQUIRES_CONFIRM") {
    return ["rerun with --yes after reviewing the operation"];
  }
  return undefined;
}
