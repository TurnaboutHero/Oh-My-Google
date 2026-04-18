import { runSecretList, runSecretSet, type RunSecretOutcome } from "../../cli/commands/secret.js";
import type { OmgResponse } from "./types.js";

export const secretListTool = {
  name: "omg.secret.list",
  description: "List Secret Manager metadata without reading secret values.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
      limit: { type: "number" },
    },
    additionalProperties: false,
  },
};

export const secretSetTool = {
  name: "omg.secret.set",
  description: "Create or update a Secret Manager secret version through the trust profile.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
      name: { type: "string" },
      value: { type: "string" },
      valueFile: { type: "string" },
      dryRun: { type: "boolean" },
      approval: { type: "string" },
      yes: { type: "boolean" },
    },
    required: ["name"],
    additionalProperties: false,
  },
};

export async function handleSecretList(args: unknown): Promise<OmgResponse> {
  const parsed = parseListArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  const outcome = await runSecretList({
    cwd: process.cwd(),
    ...parsed.args,
  });

  return fromOutcome("secret:list", outcome);
}

export async function handleSecretSet(args: unknown): Promise<OmgResponse> {
  const parsed = parseSetArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  const outcome = await runSecretSet({
    cwd: process.cwd(),
    jsonMode: true,
    ...parsed.args,
  });

  return fromOutcome("secret:set", outcome);
}

function parseListArgs(
  args: unknown,
):
  | { ok: true; args: { project?: string; limit?: number } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("secret:list", "Arguments must be an object.");
  }

  for (const key of Object.keys(args)) {
    if (key !== "project" && key !== "limit") {
      return validationError("secret:list", `Unknown argument: ${key}.`);
    }
  }

  if (args.project !== undefined && typeof args.project !== "string") {
    return validationError("secret:list", "project must be a string.");
  }
  if (args.limit !== undefined && !isValidLimit(args.limit)) {
    return validationError("secret:list", "limit must be an integer from 1 to 1000.");
  }

  return {
    ok: true,
    args: {
      project: args.project,
      limit: args.limit,
    },
  };
}

function parseSetArgs(
  args: unknown,
):
  | {
      ok: true;
      args: {
        project?: string;
        name: string;
        value?: string;
        valueFile?: string;
        dryRun?: boolean;
        approval?: string;
        yes?: boolean;
      };
    }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("secret:set", "Arguments must be an object.");
  }

  for (const key of Object.keys(args)) {
    if (
      key !== "project"
      && key !== "name"
      && key !== "value"
      && key !== "valueFile"
      && key !== "dryRun"
      && key !== "approval"
      && key !== "yes"
    ) {
      return validationError("secret:set", `Unknown argument: ${key}.`);
    }
  }

  if (typeof args.name !== "string") {
    return validationError("secret:set", "name is required and must be a string.");
  }
  if (args.project !== undefined && typeof args.project !== "string") {
    return validationError("secret:set", "project must be a string.");
  }
  if (args.value !== undefined && typeof args.value !== "string") {
    return validationError("secret:set", "value must be a string.");
  }
  if (args.valueFile !== undefined && typeof args.valueFile !== "string") {
    return validationError("secret:set", "valueFile must be a string.");
  }
  if (args.dryRun !== undefined && typeof args.dryRun !== "boolean") {
    return validationError("secret:set", "dryRun must be a boolean.");
  }
  if (args.approval !== undefined && typeof args.approval !== "string") {
    return validationError("secret:set", "approval must be a string.");
  }
  if (args.yes !== undefined && typeof args.yes !== "boolean") {
    return validationError("secret:set", "yes must be a boolean.");
  }

  return {
    ok: true,
    args: {
      project: args.project,
      name: args.name,
      value: args.value,
      valueFile: args.valueFile,
      dryRun: args.dryRun,
      approval: args.approval,
      yes: args.yes,
    },
  };
}

function fromOutcome(command: string, outcome: RunSecretOutcome): OmgResponse {
  if (outcome.ok) {
    return {
      ok: true,
      command,
      data: outcome.data,
      next: outcome.next,
    };
  }

  return {
    ok: false,
    command,
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

function validationError(command: string, message: string): { ok: false; response: OmgResponse } {
  return {
    ok: false,
    response: {
      ok: false,
      command,
      error: { code: "VALIDATION_ERROR", message, recoverable: true },
    },
  };
}

function isValidLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
