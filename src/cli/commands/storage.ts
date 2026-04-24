import { Command } from "commander";
import { auditStorage } from "../../connectors/storage-audit.js";
import { OmgError, ValidationError, type OmgError as OmgErrorType } from "../../types/errors.js";
import { fail, success } from "../output.js";

export type RunStorageOutcome =
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

export const storageCommand = new Command("storage")
  .description("Audit Cloud Storage resources");

storageCommand
  .command("audit")
  .description("Read-only Cloud Storage bucket and bucket IAM audit")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .action(async (opts) => {
    const outcome = await runStorageAudit({ project: opts.project as string | undefined });
    if (outcome.ok) {
      success("storage:audit", "Cloud Storage audit complete.", outcome.data, outcome.next);
      return;
    }

    emitOutcomeError("storage:audit", outcome.error);
  });

storageCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg --output json storage audit --project my-project
`,
);

export async function runStorageAudit(input: { project?: string }): Promise<RunStorageOutcome> {
  try {
    if (!input.project?.trim()) {
      throw new ValidationError("Project ID is required.");
    }

    const audit = await auditStorage(input.project);
    return {
      ok: true,
      data: { ...audit },
      next: getStorageAuditNext(audit),
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

function getStorageAuditNext(audit: { risk?: unknown }): string[] {
  if (audit.risk === "high") {
    return ["Review public Cloud Storage IAM bindings before adding bucket, object, or lifecycle write workflows."];
  }
  if (audit.risk === "review") {
    return ["Review Cloud Storage buckets before adding bucket, object, IAM, or lifecycle mutation workflows."];
  }
  return [];
}

function emitOutcomeError(
  command: string,
  error: Extract<RunStorageOutcome, { ok: false }>["error"],
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

function toOutcomeError(error: unknown): Extract<RunStorageOutcome, { ok: false }>["error"] {
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

  return new ValidationError("Unknown Cloud Storage command error.");
}
