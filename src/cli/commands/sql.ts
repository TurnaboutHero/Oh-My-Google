import { Command } from "commander";
import { auditSql } from "../../connectors/sql-audit.js";
import { OmgError, ValidationError, type OmgError as OmgErrorType } from "../../types/errors.js";
import { fail, success } from "../output.js";

export type RunSqlOutcome =
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

export const sqlCommand = new Command("sql")
  .description("Audit Cloud SQL resources");

sqlCommand
  .command("audit")
  .description("Read-only Cloud SQL instance and backup audit")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .action(async (opts) => {
    const outcome = await runSqlAudit({ project: opts.project as string | undefined });
    if (outcome.ok) {
      success("sql:audit", "Cloud SQL audit complete.", outcome.data, outcome.next);
      return;
    }

    emitOutcomeError("sql:audit", outcome.error);
  });

sqlCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg --output json sql audit --project my-project
`,
);

export async function runSqlAudit(input: { project?: string }): Promise<RunSqlOutcome> {
  try {
    if (!input.project?.trim()) {
      throw new ValidationError("Project ID is required.");
    }

    const audit = await auditSql(input.project);
    return {
      ok: true,
      data: { ...audit },
      next: getSqlAuditNext(audit),
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

function getSqlAuditNext(audit: { risk?: unknown }): string[] {
  if (audit.risk === "high") {
    return [
      "Review public Cloud SQL network exposure before adding instance, backup, export, import, or lifecycle workflows.",
    ];
  }
  if (audit.risk === "review") {
    return ["Review Cloud SQL instances before adding instance, backup, export, import, or lifecycle mutation workflows."];
  }
  return [];
}

function emitOutcomeError(
  command: string,
  error: Extract<RunSqlOutcome, { ok: false }>["error"],
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

function toOutcomeError(error: unknown): Extract<RunSqlOutcome, { ok: false }>["error"] {
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

  return new ValidationError("Unknown Cloud SQL command error.");
}
