import { Command } from "commander";
import { auditSecurity } from "../../connectors/security-audit.js";
import { OmgError, ValidationError, type OmgError as OmgErrorType } from "../../types/errors.js";
import { fail, success } from "../output.js";

export type RunSecurityOutcome =
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

export const securityCommand = new Command("security")
  .description("Audit project security posture");

securityCommand
  .command("audit")
  .description("Read-only security posture audit")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .action(async (opts) => {
    const outcome = await runSecurityAudit({ project: opts.project as string | undefined });
    if (outcome.ok) {
      success("security:audit", "Security audit complete.", outcome.data, outcome.next);
      return;
    }

    emitOutcomeError("security:audit", outcome.error);
  });

securityCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg --output json security audit --project my-project
`,
);

export async function runSecurityAudit(input: { project?: string }): Promise<RunSecurityOutcome> {
  try {
    if (!input.project?.trim()) {
      throw new ValidationError("Project ID is required.");
    }

    const audit = await auditSecurity(input.project);
    return {
      ok: true,
      data: { ...audit },
      next: getSecurityAuditNext(audit),
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

function getSecurityAuditNext(audit: { risk?: unknown; projectId?: unknown }): string[] {
  if (audit.risk === "high") {
    return ["Review high-risk project or IAM findings manually before live operations."];
  }
  if (audit.risk === "review") {
    return ["Review security audit findings before adding new live operations."];
  }
  return [];
}

function emitOutcomeError(
  command: string,
  error: Extract<RunSecurityOutcome, { ok: false }>["error"],
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

function toOutcomeError(error: unknown): Extract<RunSecurityOutcome, { ok: false }>["error"] {
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

  return new ValidationError("Unknown security command error.");
}
