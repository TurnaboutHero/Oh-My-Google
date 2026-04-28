import { Command } from "commander";
import {
  getCostLockStatus,
  lockCost,
  unlockCost,
} from "../../cost-lock/state.js";
import { createRunId, tryAppendDecision } from "../../harness/decision-log.js";
import { OmgError, ValidationError, type OmgError as OmgErrorType } from "../../types/errors.js";
import { fail, success } from "../output.js";

export type RunCostOutcome =
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

export const costCommand = new Command("cost")
  .description("Inspect and manage local cost-bearing operation locks");

costCommand
  .command("status")
  .description("Read local cost lock status")
  .option("--project <id>", "Google Cloud project ID")
  .action(async (opts) => {
    const outcome = await runCostStatus({
      cwd: process.cwd(),
      project: opts.project as string | undefined,
    });
    emitOutcome("cost:status", "Cost lock status read.", outcome);
  });

costCommand
  .command("lock")
  .description("Lock omg cost-bearing live operations for a project")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .requiredOption("--reason <text>", "Reason for the lock")
  .option("--locked-by <actor>", "Actor recorded in the local lock file")
  .action(async (opts) => {
    const outcome = await runCostLock({
      cwd: process.cwd(),
      project: opts.project as string | undefined,
      reason: opts.reason as string | undefined,
      lockedBy: opts.lockedBy as string | undefined,
    });
    emitOutcome("cost:lock", "Cost lock recorded.", outcome);
  });

costCommand
  .command("unlock")
  .description("Unlock omg cost-bearing live operations for a project")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .option("-y, --yes", "Confirm local cost unlock")
  .action(async (opts) => {
    const outcome = await runCostUnlock({
      cwd: process.cwd(),
      project: opts.project as string | undefined,
      yes: !!opts.yes,
    });
    emitOutcome("cost:unlock", "Cost lock cleared.", outcome);
  });

costCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg cost status
  omg cost status --project my-project
  omg cost lock --project my-project --reason "budget alert threshold exceeded"
  omg cost unlock --project my-project --yes
`,
);

export async function runCostStatus(input: {
  cwd: string;
  project?: string;
}): Promise<RunCostOutcome> {
  try {
    const status = await getCostLockStatus(input.cwd, input.project);
    return {
      ok: true,
      data: { ...status },
      next: status.locked && status.projectId ? [`omg cost unlock --project ${status.projectId} --yes`] : [],
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

export async function runCostLock(input: {
  cwd: string;
  project?: string;
  reason?: string;
  lockedBy?: string;
}): Promise<RunCostOutcome> {
  const runId = createRunId("cost-lock");
  try {
    const result = await lockCost(input.cwd, {
      projectId: input.project ?? "",
      reason: input.reason ?? "",
      lockedBy: input.lockedBy ?? getActor(),
    });
    await tryAppendDecision(input.cwd, {
      runId,
      command: "cost:lock",
      phase: "execute",
      status: "success",
      action: "cost.lock",
      projectId: result.lock.projectId,
      result,
      next: [`omg cost status --project ${result.lock.projectId}`],
    });
    return {
      ok: true,
      data: { ...result, locked: true },
      next: [`omg cost status --project ${result.lock.projectId}`],
    };
  } catch (error) {
    await tryAppendDecision(input.cwd, {
      runId,
      command: "cost:lock",
      phase: "execute",
      status: "failure",
      action: "cost.lock",
      result: toOutcomeError(error),
    });
    return { ok: false, error: toOutcomeError(error) };
  }
}

export async function runCostUnlock(input: {
  cwd: string;
  project?: string;
  yes?: boolean;
}): Promise<RunCostOutcome> {
  const runId = createRunId("cost-unlock");
  try {
    if (!input.yes) {
      return {
        ok: false,
        error: {
          code: "TRUST_REQUIRES_CONFIRM",
          message: "Cost unlock requires explicit --yes.",
          recoverable: true,
          hint: "--yes",
          data: {
            projectId: input.project,
            localOnly: true,
          },
          next: input.project ? [`omg cost unlock --project ${input.project} --yes`] : undefined,
        },
      };
    }

    const result = await unlockCost(input.cwd, {
      projectId: input.project ?? "",
    });
    await tryAppendDecision(input.cwd, {
      runId,
      command: "cost:unlock",
      phase: "execute",
      status: "success",
      action: "cost.unlock",
      projectId: input.project,
      result,
      next: input.project ? [`omg cost status --project ${input.project}`] : undefined,
    });
    return {
      ok: true,
      data: { ...result, locked: false },
      next: input.project ? [`omg cost status --project ${input.project}`] : [],
    };
  } catch (error) {
    await tryAppendDecision(input.cwd, {
      runId,
      command: "cost:unlock",
      phase: "execute",
      status: "failure",
      action: "cost.unlock",
      result: toOutcomeError(error),
    });
    return { ok: false, error: toOutcomeError(error) };
  }
}

function emitOutcome(command: string, message: string, outcome: RunCostOutcome): void {
  if (outcome.ok) {
    success(command, message, outcome.data, outcome.next);
    return;
  }

  fail(
    command,
    outcome.error.code,
    outcome.error.message,
    outcome.error.recoverable,
    outcome.error.hint,
    outcome.error.data,
    outcome.error.next,
  );
  process.exit(1);
}

function toOutcomeError(error: unknown): Extract<RunCostOutcome, { ok: false }>["error"] {
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
  return new ValidationError("Unknown cost lock command error.");
}

function getActor(): string {
  return process.env.USER || process.env.USERNAME || "agent";
}
