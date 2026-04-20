import { Command } from "commander";
import { auditBillingGuard } from "../../connectors/billing-audit.js";
import { enableApis } from "../../setup/apis.js";
import { OmgError, ValidationError, type OmgError as OmgErrorType } from "../../types/errors.js";
import { fail, success } from "../output.js";

const BUDGET_API = "billingbudgets.googleapis.com";

export type RunBudgetOutcome =
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

export const budgetCommand = new Command("budget")
  .description("Audit billing and budget guardrails");

budgetCommand
  .command("audit")
  .description("Read-only billing budget guard audit")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .action(async (opts) => {
    const outcome = await runBudgetAudit({ project: opts.project as string | undefined });
    if (outcome.ok) {
      success("budget:audit", "Budget guard audit complete.", outcome.data, outcome.next);
      return;
    }

    fail(
      "budget:audit",
      outcome.error.code,
      outcome.error.message,
      outcome.error.recoverable,
      outcome.error.hint,
      outcome.error.data,
      outcome.error.next,
    );
    process.exit(1);
  });

budgetCommand
  .command("enable-api")
  .description("Enable the Cloud Billing Budget API with explicit confirmation")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .option("--dry-run", "Show the API enable plan without calling gcloud")
  .option("-y, --yes", "Enable the API")
  .action(async (opts) => {
    const outcome = await runBudgetEnableApi({
      project: opts.project as string | undefined,
      dryRun: !!opts.dryRun,
      yes: !!opts.yes,
    });
    if (outcome.ok) {
      success(
        "budget:enable-api",
        outcome.data.dryRun ? "Budget API enable plan ready." : "Budget API enabled.",
        outcome.data,
        outcome.next,
      );
      return;
    }

    fail(
      "budget:enable-api",
      outcome.error.code,
      outcome.error.message,
      outcome.error.recoverable,
      outcome.error.hint,
      outcome.error.data,
      outcome.error.next,
    );
    process.exit(1);
  });

budgetCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg --output json budget audit --project my-project
  omg --output json budget enable-api --project my-project --dry-run
  omg --output json budget enable-api --project my-project --yes
`,
);

export async function runBudgetAudit(input: { project?: string }): Promise<RunBudgetOutcome> {
  try {
    if (!input.project?.trim()) {
      throw new ValidationError("Project ID is required.");
    }

    const audit = await auditBillingGuard(input.project);
    return {
      ok: true,
      data: { ...audit },
      next: getBudgetAuditNext(audit),
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

export async function runBudgetEnableApi(input: {
  project?: string;
  dryRun?: boolean;
  yes?: boolean;
}): Promise<RunBudgetOutcome> {
  try {
    if (!input.project?.trim()) {
      throw new ValidationError("Project ID is required.");
    }

    const projectId = input.project.trim();
    const data = {
      projectId,
      api: BUDGET_API,
      dryRun: !!input.dryRun,
    };

    if (input.dryRun) {
      return {
        ok: true,
        data,
        next: [`omg budget enable-api --project ${projectId} --yes`],
      };
    }

    if (!input.yes) {
      return {
        ok: false,
        error: {
          code: "TRUST_REQUIRES_CONFIRM",
          message: "Enabling the Cloud Billing Budget API requires explicit --yes.",
          recoverable: true,
          hint: `Run omg budget enable-api --project ${projectId} --dry-run first, then rerun with --yes.`,
          data,
          next: [`omg budget enable-api --project ${projectId} --dry-run`],
        },
      };
    }

    await enableApis(projectId, [BUDGET_API]);
    return {
      ok: true,
      data: {
        ...data,
        dryRun: false,
        enabled: true,
      },
      next: [`omg budget audit --project ${projectId}`],
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

function getBudgetAuditNext(audit: {
  risk?: unknown;
  billingAccountId?: unknown;
}): string[] {
  if (audit.risk === "missing_budget" && typeof audit.billingAccountId === "string") {
    return [`Create a billing budget for billing account ${audit.billingAccountId}.`];
  }
  if (audit.risk === "review") {
    return ["Review billing budget permissions before live cost-bearing operations."];
  }
  if (audit.risk === "billing_disabled") {
    return ["Keep cost-bearing live operations blocked until billing is intentionally enabled."];
  }
  return [];
}

function toOutcomeError(error: unknown): Extract<RunBudgetOutcome, { ok: false }>["error"] {
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

  return new ValidationError("Unknown budget command error.");
}
