import { Command } from "commander";
import { auditFirestore } from "../../connectors/firestore-audit.js";
import { OmgError, ValidationError, type OmgError as OmgErrorType } from "../../types/errors.js";
import { fail, success } from "../output.js";

export type RunFirestoreOutcome =
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

export const firestoreCommand = new Command("firestore")
  .description("Audit Firestore resources");

firestoreCommand
  .command("audit")
  .description("Read-only Firestore database and index audit")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .action(async (opts) => {
    const outcome = await runFirestoreAudit({ project: opts.project as string | undefined });
    if (outcome.ok) {
      success("firestore:audit", "Firestore audit complete.", outcome.data, outcome.next);
      return;
    }

    emitOutcomeError("firestore:audit", outcome.error);
  });

firestoreCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg --output json firestore audit --project my-project
`,
);

export async function runFirestoreAudit(input: { project?: string }): Promise<RunFirestoreOutcome> {
  try {
    if (!input.project?.trim()) {
      throw new ValidationError("Project ID is required.");
    }

    const audit = await auditFirestore(input.project);
    return {
      ok: true,
      data: { ...audit },
      next: getFirestoreAuditNext(audit),
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

function getFirestoreAuditNext(audit: { risk?: unknown }): string[] {
  if (audit.risk === "review") {
    return ["Review Firestore databases before adding create, delete, export, import, or data mutation workflows."];
  }
  return [];
}

function emitOutcomeError(
  command: string,
  error: Extract<RunFirestoreOutcome, { ok: false }>["error"],
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

function toOutcomeError(error: unknown): Extract<RunFirestoreOutcome, { ok: false }>["error"] {
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

  return new ValidationError("Unknown Firestore command error.");
}
