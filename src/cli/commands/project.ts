import { Command } from "commander";
import { auditProject, buildCleanupPlan } from "../../connectors/project-audit.js";
import { OmgError, ValidationError, type OmgError as OmgErrorType } from "../../types/errors.js";
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

projectCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg --output json project audit --project my-project
  omg --output json project cleanup --project my-project --dry-run
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
