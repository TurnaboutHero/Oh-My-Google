import {
  runCostLock,
  runCostStatus,
  runCostUnlock,
  type RunCostOutcome,
} from "../../cli/commands/cost.js";
import type { OmgResponse } from "./types.js";

export const costStatusTool = {
  name: "omg.cost.status",
  description: "Read local cost lock status.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
    },
    additionalProperties: false,
  },
};

export const costLockTool = {
  name: "omg.cost.lock",
  description: "Set a local cost lock for a project. This writes only local .omg state.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
      reason: { type: "string" },
      lockedBy: { type: "string" },
    },
    required: ["project", "reason"],
    additionalProperties: false,
  },
};

export const costUnlockTool = {
  name: "omg.cost.unlock",
  description: "Clear a local cost lock for a project. Requires explicit yes.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
      yes: { type: "boolean" },
    },
    required: ["project"],
    additionalProperties: false,
  },
};

export async function handleCostStatus(args: unknown): Promise<OmgResponse> {
  const parsed = parseStatusArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome("cost:status", await runCostStatus({ cwd: process.cwd(), ...parsed.args }));
}

export async function handleCostLock(args: unknown): Promise<OmgResponse> {
  const parsed = parseLockArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome("cost:lock", await runCostLock({ cwd: process.cwd(), ...parsed.args }));
}

export async function handleCostUnlock(args: unknown): Promise<OmgResponse> {
  const parsed = parseUnlockArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome("cost:unlock", await runCostUnlock({ cwd: process.cwd(), ...parsed.args }));
}

function parseStatusArgs(args: unknown):
  | { ok: true; args: { project?: string } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("cost:status", "Arguments must be an object.");
  }
  const unknown = Object.keys(args).find((key) => key !== "project");
  if (unknown) {
    return validationError("cost:status", `Unknown argument: ${unknown}.`);
  }
  if (args.project !== undefined && typeof args.project !== "string") {
    return validationError("cost:status", "project must be a string.");
  }
  return { ok: true, args: { project: args.project } };
}

function parseLockArgs(args: unknown):
  | { ok: true; args: { project: string; reason: string; lockedBy?: string } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("cost:lock", "Arguments must be an object.");
  }
  const unknown = Object.keys(args).find((key) => key !== "project" && key !== "reason" && key !== "lockedBy");
  if (unknown) {
    return validationError("cost:lock", `Unknown argument: ${unknown}.`);
  }
  if (typeof args.project !== "string") {
    return validationError("cost:lock", "project is required and must be a string.");
  }
  if (typeof args.reason !== "string") {
    return validationError("cost:lock", "reason is required and must be a string.");
  }
  if (args.lockedBy !== undefined && typeof args.lockedBy !== "string") {
    return validationError("cost:lock", "lockedBy must be a string.");
  }
  return {
    ok: true,
    args: {
      project: args.project,
      reason: args.reason,
      lockedBy: args.lockedBy,
    },
  };
}

function parseUnlockArgs(args: unknown):
  | { ok: true; args: { project: string; yes?: boolean } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("cost:unlock", "Arguments must be an object.");
  }
  const unknown = Object.keys(args).find((key) => key !== "project" && key !== "yes");
  if (unknown) {
    return validationError("cost:unlock", `Unknown argument: ${unknown}.`);
  }
  if (typeof args.project !== "string") {
    return validationError("cost:unlock", "project is required and must be a string.");
  }
  if (args.yes !== undefined && typeof args.yes !== "boolean") {
    return validationError("cost:unlock", "yes must be a boolean.");
  }
  return { ok: true, args: { project: args.project, yes: args.yes } };
}

function fromOutcome(command: string, outcome: RunCostOutcome): OmgResponse {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
