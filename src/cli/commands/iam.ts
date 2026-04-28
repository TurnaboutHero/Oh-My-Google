import { Command } from "commander";
import { auditIam } from "../../connectors/iam-audit.js";
import { planAgentIam } from "../../iam/agent-plan.js";
import { OmgError, ValidationError, type OmgError as OmgErrorType } from "../../types/errors.js";
import { fail, success } from "../output.js";

export type RunIamOutcome =
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

export const iamCommand = new Command("iam")
  .description("Audit Google Cloud IAM posture");

iamCommand
  .command("audit")
  .description("Read-only IAM policy and service account audit")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .action(async (opts) => {
    const outcome = await runIamAudit({ project: opts.project as string | undefined });
    if (outcome.ok) {
      success("iam:audit", "IAM audit complete.", outcome.data, outcome.next);
      return;
    }

    emitOutcomeError("iam:audit", outcome.error);
  });

iamCommand
  .command("plan")
  .description("Plan separated agent IAM identities without applying grants")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .option("--prefix <name>", "Service account ID prefix", "omg-agent")
  .action(async (opts) => {
    const outcome = await runIamPlan({
      project: opts.project as string | undefined,
      prefix: opts.prefix as string | undefined,
    });
    if (outcome.ok) {
      success("iam:plan", "Agent IAM plan ready.", outcome.data, outcome.next);
      return;
    }

    emitOutcomeError("iam:plan", outcome.error);
  });

iamCommand
  .command("bootstrap")
  .description("Dry-run separated agent IAM bootstrap steps")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .option("--prefix <name>", "Service account ID prefix", "omg-agent")
  .option("--dry-run", "Plan service account and IAM grant changes without applying them")
  .option("-y, --yes", "Reserved for future live IAM bootstrap")
  .action(async (opts) => {
    const outcome = await runIamBootstrap({
      project: opts.project as string | undefined,
      prefix: opts.prefix as string | undefined,
      dryRun: !!opts.dryRun,
      yes: !!opts.yes,
    });
    if (outcome.ok) {
      success("iam:bootstrap", "Agent IAM bootstrap dry-run ready.", outcome.data, outcome.next);
      return;
    }

    emitOutcomeError("iam:bootstrap", outcome.error);
  });

iamCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg --output json iam audit --project my-project
  omg --output json iam plan --project my-project
  omg --output json iam bootstrap --project my-project --dry-run
`,
);

export async function runIamAudit(input: { project?: string }): Promise<RunIamOutcome> {
  try {
    const projectId = requireProjectId(input.project);

    const audit = await auditIam(projectId);
    return {
      ok: true,
      data: { ...audit },
      next: getIamAuditNext(audit),
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

export async function runIamPlan(input: {
  project?: string;
  prefix?: string;
}): Promise<RunIamOutcome> {
  try {
    const projectId = requireProjectId(input.project);

    const audit = await auditIam(projectId);
    const plan = planAgentIam(audit, { prefix: input.prefix });
    return {
      ok: true,
      data: { ...plan },
      next: plan.next,
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

export async function runIamBootstrap(input: {
  project?: string;
  prefix?: string;
  dryRun?: boolean;
  yes?: boolean;
}): Promise<RunIamOutcome> {
  try {
    const projectId = requireProjectId(input.project);

    if (!input.dryRun) {
      return {
        ok: false,
        error: input.yes
          ? {
              code: "IAM_BOOTSTRAP_LIVE_NOT_IMPLEMENTED",
              message: "Live agent IAM bootstrap is not implemented in this safe foundation pass.",
              recoverable: true,
              hint: "Run --dry-run first and implement a reviewed IAM grant executor before enabling live mutation.",
              data: {
                projectId,
                liveMutation: false,
              },
              next: [`omg iam bootstrap --project ${projectId} --dry-run`],
            }
          : {
              code: "TRUST_REQUIRES_CONFIRM",
              message: "IAM bootstrap requires --dry-run in the current safe implementation.",
              recoverable: true,
              hint: "Run with --dry-run to inspect proposed service accounts and IAM bindings without mutation.",
              data: {
                projectId,
                liveMutation: false,
              },
              next: [`omg iam bootstrap --project ${projectId} --dry-run`],
            },
      };
    }

    const audit = await auditIam(projectId);
    const plan = planAgentIam(audit, { prefix: input.prefix });
    return {
      ok: true,
      data: {
        dryRun: true,
        liveMutation: false,
        ...plan,
      },
      next: plan.next,
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

function requireProjectId(project: string | undefined): string {
  const projectId = project?.trim() ?? "";
  if (!projectId) {
    throw new ValidationError("Project ID is required.");
  }
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new ValidationError("A valid project ID is required.");
  }
  return projectId;
}

function getIamAuditNext(audit: { risk?: unknown; projectId?: unknown }): string[] {
  if (audit.risk === "high" && typeof audit.projectId === "string") {
    return [`Review IAM policy in Google Cloud Console for project ${audit.projectId}.`];
  }
  if (audit.risk === "review") {
    return ["Review privileged IAM bindings before adding IAM write automation."];
  }
  return [];
}

function emitOutcomeError(
  command: string,
  error: Extract<RunIamOutcome, { ok: false }>["error"],
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

function toOutcomeError(error: unknown): Extract<RunIamOutcome, { ok: false }>["error"] {
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

  return new ValidationError("Unknown IAM command error.");
}
