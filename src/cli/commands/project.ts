import { Command } from "commander";
import { createApproval } from "../../approval/queue.js";
import { hashArgs } from "../../approval/hash.js";
import {
  auditProject,
  buildCleanupPlan,
  deleteProject,
  readActiveGcloudAccount,
  readProjectLifecycle,
  undeleteProject,
} from "../../connectors/project-audit.js";
import { checkPermission } from "../../trust/check.js";
import { generateDefaultProfile } from "../../trust/profile.js";
import { OmgError, ValidationError, type OmgError as OmgErrorType } from "../../types/errors.js";
import type { TrustProfile } from "../../types/trust.js";
import { fail, success } from "../output.js";

export type RunProjectOutcome =
  | { ok: true; data: Record<string, unknown>; next?: string[] }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        recoverable: boolean;
        hint?: string;
        data?: Record<string, unknown>;
        next?: string[];
      };
    };

export const projectCommand = new Command("project")
  .description("Audit Google Cloud projects before any cleanup work");

projectCommand
  .command("audit")
  .description("Read-only project audit")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .action(async (opts) => {
    const outcome = await runProjectAudit({ project: String(opts.project) });
    if (outcome.ok) {
      success("project:audit", "Project audit complete.", outcome.data, outcome.next);
      return;
    }

    emitOutcomeError("project:audit", outcome.error);
  });

projectCommand
  .command("cleanup")
  .description("Build a dry-run-only cleanup plan")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .option("--dry-run", "Required; no live cleanup execution is implemented")
  .action(async (opts) => {
    const outcome = await runProjectCleanup({
      project: String(opts.project),
      dryRun: !!opts.dryRun,
    });
    if (outcome.ok) {
      success("project:cleanup", "Project cleanup dry-run ready.", outcome.data, outcome.next);
      return;
    }

    emitOutcomeError("project:cleanup", outcome.error);
  });

projectCommand
  .command("delete")
  .description("Delete a project through an explicit L3 approval gate")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .option("--approval <id>", "Manual approval request ID")
  .option("--expect-account <email>", "Require this active gcloud account before requesting or executing deletion")
  .action(async (opts) => {
    const outcome = await runProjectDelete({
      cwd: process.cwd(),
      project: String(opts.project),
      approval: opts.approval as string | undefined,
      expectedAccount: opts.expectAccount as string | undefined,
    });
    if (outcome.ok) {
      success("project:delete", "Project delete requested.", outcome.data, outcome.next);
      return;
    }

    emitOutcomeError("project:delete", outcome.error);
  });

projectCommand
  .command("undelete")
  .description("Restore a DELETE_REQUESTED project through an explicit L3 approval gate")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .option("--approval <id>", "Manual approval request ID")
  .option("--expect-account <email>", "Require this active gcloud account before requesting or executing undeletion")
  .action(async (opts) => {
    const outcome = await runProjectUndelete({
      cwd: process.cwd(),
      project: String(opts.project),
      approval: opts.approval as string | undefined,
      expectedAccount: opts.expectAccount as string | undefined,
    });
    if (outcome.ok) {
      success("project:undelete", "Project undelete requested.", outcome.data, outcome.next);
      return;
    }

    emitOutcomeError("project:undelete", outcome.error);
  });

projectCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg --output json project audit --project my-project
  omg --output json project cleanup --project my-project --dry-run
  omg --output json project delete --project my-project
  omg approve <approval-id>
  omg --output json project delete --project my-project --approval <approval-id>
  omg --output json project undelete --project my-project
  omg approve <approval-id>
  omg --output json project undelete --project my-project --approval <approval-id>
`,
);

export async function runProjectAudit(input: { project: string }): Promise<RunProjectOutcome> {
  try {
    const audit = await auditProject(input.project);
    return { ok: true, data: { ...audit } };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

export async function runProjectCleanup(input: { project: string; dryRun?: boolean }): Promise<RunProjectOutcome> {
  try {
    if (!input.dryRun) {
      throw new ValidationError("Project cleanup only supports --dry-run.");
    }

    const audit = await auditProject(input.project);
    const plan = buildCleanupPlan(audit);
    return { ok: true, data: { ...plan }, next: plan.next };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

export async function runProjectDelete(input: {
  cwd: string;
  project: string;
  approval?: string;
  requester?: string;
  expectedAccount?: string;
}): Promise<RunProjectOutcome> {
  try {
    const audit = await auditProject(input.project);
    const block = getDeleteBlockReason(audit);
    if (block) {
      return {
        ok: false,
        error: {
          code: "TRUST_DENIED",
          message: block,
          recoverable: false,
          data: { projectId: audit.projectId, risk: audit.risk, signals: audit.signals },
        },
      };
    }

    const action = "gcp.project.delete";
    const activeAccount = await readActiveGcloudAccount();
    const accountMismatch = getExpectedAccountMismatch(input.expectedAccount, activeAccount);
    if (accountMismatch) {
      return accountMismatch;
    }
    const args = {
      projectId: audit.projectId,
      lifecycleState: audit.lifecycleState,
      billingEnabled: audit.billingEnabled,
    };
    const profile = getDeleteTrustProfile(audit.projectId);
    const permission = await checkPermission(action, profile, {
      approvalId: input.approval,
      argsHash: hashArgs(args),
      activeAccount,
      cwd: input.cwd,
      jsonMode: true,
    });

    if (!permission.allowed) {
      if (permission.reasonCode === "APPROVAL_REQUIRED") {
        const approval = await createApproval(input.cwd, {
          action,
          args,
          projectId: audit.projectId,
          environment: "prod",
          requestedBy: input.requester ?? getRequester(),
          requestedAccount: activeAccount,
        });
        return {
          ok: false,
          error: {
            code: "APPROVAL_REQUIRED",
            message: `Project delete requires manual approval. Approval ${approval.id} created.`,
            recoverable: true,
            data: {
              approvalId: approval.id,
              action,
              activeAccount,
              expectedAccount: input.expectedAccount,
              expiresAt: approval.expiresAt,
            },
            next: [
              `omg approve ${approval.id}`,
              `omg project delete --project ${audit.projectId} --approval ${approval.id}`,
            ],
          },
        };
      }

      return {
        ok: false,
        error: {
          code: mapPermissionCode(permission.reasonCode),
          message: permission.reason ?? "Project delete blocked by trust profile.",
          recoverable: false,
          hint: permission.approvalId ? `omg approve ${permission.approvalId}` : undefined,
        },
      };
    }

    const result = await deleteProject(audit.projectId);
    return {
      ok: true,
      data: { ...result },
      next: [`gcloud projects describe ${audit.projectId}`],
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

export async function runProjectUndelete(input: {
  cwd: string;
  project: string;
  approval?: string;
  requester?: string;
  expectedAccount?: string;
}): Promise<RunProjectOutcome> {
  try {
    const lifecycle = await readProjectLifecycle(input.project);
    if (lifecycle.lifecycleState !== "DELETE_REQUESTED") {
      throw new ValidationError(
        `Project ${lifecycle.projectId} must be DELETE_REQUESTED before omg can undelete it.`,
      );
    }

    const action = "gcp.project.undelete";
    const activeAccount = await readActiveGcloudAccount();
    const accountMismatch = getExpectedAccountMismatch(input.expectedAccount, activeAccount);
    if (accountMismatch) {
      return accountMismatch;
    }
    const args = {
      projectId: lifecycle.projectId,
      lifecycleState: lifecycle.lifecycleState,
    };
    const profile = getProjectL3ApprovalTrustProfile(lifecycle.projectId, action);
    const permission = await checkPermission(action, profile, {
      approvalId: input.approval,
      argsHash: hashArgs(args),
      activeAccount,
      cwd: input.cwd,
      jsonMode: true,
    });

    if (!permission.allowed) {
      if (permission.reasonCode === "APPROVAL_REQUIRED") {
        const approval = await createApproval(input.cwd, {
          action,
          args,
          projectId: lifecycle.projectId,
          environment: "prod",
          requestedBy: input.requester ?? getRequester(),
          requestedAccount: activeAccount,
        });
        return {
          ok: false,
          error: {
            code: "APPROVAL_REQUIRED",
            message: `Project undelete requires manual approval. Approval ${approval.id} created.`,
            recoverable: true,
            data: {
              approvalId: approval.id,
              action,
              activeAccount,
              expectedAccount: input.expectedAccount,
              expiresAt: approval.expiresAt,
            },
            next: [
              `omg approve ${approval.id}`,
              `omg project undelete --project ${lifecycle.projectId} --approval ${approval.id}`,
            ],
          },
        };
      }

      return {
        ok: false,
        error: {
          code: mapPermissionCode(permission.reasonCode),
          message: permission.reason ?? "Project undelete blocked by trust profile.",
          recoverable: false,
          hint: permission.approvalId ? `omg approve ${permission.approvalId}` : undefined,
        },
      };
    }

    const result = await undeleteProject(lifecycle.projectId);
    return {
      ok: true,
      data: { ...result },
      next: [`omg project audit --project ${lifecycle.projectId}`],
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

function getExpectedAccountMismatch(
  expectedAccount: string | undefined,
  activeAccount: string,
): RunProjectOutcome | undefined {
  if (!expectedAccount || expectedAccount === activeAccount) {
    return undefined;
  }

  return {
    ok: false,
    error: {
      code: "ACCOUNT_MISMATCH",
      message: `Expected active gcloud account ${expectedAccount}, but current active account is ${activeAccount}.`,
      recoverable: true,
      data: { expectedAccount, activeAccount },
    },
  };
}

function getDeleteBlockReason(audit: Awaited<ReturnType<typeof auditProject>>): string | undefined {
  const protectedProjects = getProtectedProjects();
  if (protectedProjects.has(audit.projectId)) {
    return `Project ${audit.projectId} is protected and cannot be deleted by omg.`;
  }
  if (audit.risk === "do_not_touch") {
    return "Project audit classified this project as do_not_touch.";
  }
  if (!audit.callerRoles.includes("roles/owner")) {
    return "Caller must have roles/owner before project deletion can be requested.";
  }
  if (audit.billingEnabled) {
    return "Billing-enabled projects require manual console review before deletion.";
  }
  return undefined;
}

function getProtectedProjects(): Set<string> {
  const builtIn = ["review-program-system", "quadratic-signifier-fmd0t"];
  const local = (process.env.OMG_PROTECTED_PROJECTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return new Set([...builtIn, ...local]);
}

function getDeleteTrustProfile(projectId: string): TrustProfile {
  return getProjectL3ApprovalTrustProfile(projectId, "gcp.project.delete");
}

function getProjectL3ApprovalTrustProfile(projectId: string, action: string): TrustProfile {
  const profile = generateDefaultProfile(projectId, "prod");
  return {
    ...profile,
    deny: (profile.deny ?? []).filter((pattern) => pattern !== action),
    rules: {
      ...profile.rules,
      L3: "require_approval",
    },
  };
}

function emitOutcomeError(
  command: string,
  error: Extract<RunProjectOutcome, { ok: false }>["error"],
): never {
  fail(
    command,
    error.code,
    error.message,
    error.recoverable,
    error.hint,
    error.data,
    error.next,
  );
  process.exit(1);
}

function toOutcomeError(error: unknown): Extract<RunProjectOutcome, { ok: false }>["error"] {
  const omgError = toOmgError(error);
  return {
    code: omgError.code,
    message: omgError.message,
    recoverable: omgError.recoverable,
  };
}

function toOmgError(error: unknown): OmgErrorType {
  if (error instanceof OmgError) {
    return error;
  }

  if (error instanceof Error) {
    return new ValidationError(error.message);
  }

  return new ValidationError("Unknown project command error.");
}

function mapPermissionCode(reasonCode: string | undefined): string {
  switch (reasonCode) {
    case "DENIED":
      return "TRUST_DENIED";
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
      return "TRUST_REQUIRES_APPROVAL";
  }
}

function getRequester(): string {
  return process.env.USER || process.env.USERNAME || "agent";
}
