import { runDeploy } from "../../cli/commands/deploy.js";
import type { OmgResponse } from "./types.js";

export const deployTool = {
  name: "omg.deploy",
  description: "Deploy according to .omg/project.yaml through the trust profile.",
  inputSchema: {
    type: "object",
    properties: {
      dryRun: { type: "boolean" },
      approval: { type: "string" },
      yes: { type: "boolean" },
    },
    additionalProperties: false,
  },
};

export async function handleDeploy(args: unknown): Promise<OmgResponse> {
  const parsed = parseArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  const outcome = await runDeploy({
    cwd: process.cwd(),
    jsonMode: true,
    ...parsed.args,
  });

  if (outcome.ok) {
    return {
      ok: true,
      command: "deploy",
      data: outcome.data as Record<string, unknown>,
      next: outcome.next,
    };
  }

  return {
    ok: false,
    command: "deploy",
    data: outcome.error.data,
    error: {
      code: outcome.error.code,
      message: outcome.error.message,
      recoverable: outcome.error.recoverable,
      hint: outcome.error.hint,
    },
    next: outcome.error.next,
  };
}

function parseArgs(
  args: unknown,
):
  | { ok: true; args: { dryRun?: boolean; approval?: string; yes?: boolean } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("Arguments must be an object.");
  }

  for (const key of Object.keys(args)) {
    if (key !== "dryRun" && key !== "approval" && key !== "yes") {
      return validationError(`Unknown argument: ${key}.`);
    }
  }

  if (args.dryRun !== undefined && typeof args.dryRun !== "boolean") {
    return validationError("dryRun must be a boolean.");
  }
  if (args.approval !== undefined && typeof args.approval !== "string") {
    return validationError("approval must be a string.");
  }
  if (args.yes !== undefined && typeof args.yes !== "boolean") {
    return validationError("yes must be a boolean.");
  }

  return {
    ok: true,
    args: {
      dryRun: args.dryRun,
      approval: args.approval,
      yes: args.yes,
    },
  };
}

function validationError(message: string): { ok: false; response: OmgResponse } {
  return {
    ok: false,
    response: {
      ok: false,
      command: "deploy",
      error: { code: "VALIDATION_ERROR", message, recoverable: true },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
