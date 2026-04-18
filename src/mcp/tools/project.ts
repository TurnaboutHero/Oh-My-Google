import { runProjectAudit, runProjectCleanup, type RunProjectOutcome } from "../../cli/commands/project.js";
import type { OmgResponse } from "./types.js";

export const projectAuditTool = {
  name: "omg.project.audit",
  description: "Read-only Google Cloud project audit for cleanup risk classification.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
    },
    required: ["project"],
    additionalProperties: false,
  },
};

export const projectCleanupTool = {
  name: "omg.project.cleanup",
  description: "Dry-run-only project cleanup plan. It never deletes or disables resources.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
      dryRun: { type: "boolean" },
    },
    required: ["project", "dryRun"],
    additionalProperties: false,
  },
};

export async function handleProjectAudit(args: unknown): Promise<OmgResponse> {
  const parsed = parseAuditArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome("project:audit", await runProjectAudit(parsed.args));
}

export async function handleProjectCleanup(args: unknown): Promise<OmgResponse> {
  const parsed = parseCleanupArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome("project:cleanup", await runProjectCleanup(parsed.args));
}

function parseAuditArgs(args: unknown):
  | { ok: true; args: { project: string } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("project:audit", "Arguments must be an object.");
  }
  for (const key of Object.keys(args)) {
    if (key !== "project") {
      return validationError("project:audit", `Unknown argument: ${key}.`);
    }
  }
  if (typeof args.project !== "string") {
    return validationError("project:audit", "project is required and must be a string.");
  }
  return { ok: true, args: { project: args.project } };
}

function parseCleanupArgs(args: unknown):
  | { ok: true; args: { project: string; dryRun?: boolean } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("project:cleanup", "Arguments must be an object.");
  }
  for (const key of Object.keys(args)) {
    if (key !== "project" && key !== "dryRun") {
      return validationError("project:cleanup", `Unknown argument: ${key}.`);
    }
  }
  if (typeof args.project !== "string") {
    return validationError("project:cleanup", "project is required and must be a string.");
  }
  if (args.dryRun !== undefined && typeof args.dryRun !== "boolean") {
    return validationError("project:cleanup", "dryRun must be a boolean.");
  }
  return { ok: true, args: { project: args.project, dryRun: args.dryRun } };
}

function fromOutcome(command: string, outcome: RunProjectOutcome): OmgResponse {
  if (outcome.ok) {
    return { ok: true, command, data: outcome.data, next: outcome.next };
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
