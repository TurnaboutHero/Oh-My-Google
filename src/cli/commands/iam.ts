import { Command } from "commander";
import { auditIam } from "../../connectors/iam-audit.js";
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

iamCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg --output json iam audit --project my-project
`,
);

export async function runIamAudit(input: { project?: string }): Promise<RunIamOutcome> {
  try {
    if (!input.project?.trim()) {
      throw new ValidationError("Project ID is required.");
    }

    const audit = await auditIam(input.project);
    return {
      ok: true,
      data: { ...audit },
      next: getIamAuditNext(audit),
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
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
