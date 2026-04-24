import { runStorageAudit, type RunStorageOutcome } from "../../cli/commands/storage.js";
import type { OmgResponse } from "./types.js";

export const storageAuditTool = {
  name: "omg.storage.audit",
  description: "Read-only Cloud Storage bucket and bucket IAM audit for a Google Cloud project.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
    },
    required: ["project"],
    additionalProperties: false,
  },
};

export async function handleStorageAudit(args: unknown): Promise<OmgResponse> {
  const parsed = parseAuditArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome("storage:audit", await runStorageAudit(parsed.args));
}

function parseAuditArgs(args: unknown):
  | { ok: true; args: { project: string } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("Arguments must be an object.");
  }
  for (const key of Object.keys(args)) {
    if (key !== "project") {
      return validationError(`Unknown argument: ${key}.`);
    }
  }
  if (typeof args.project !== "string") {
    return validationError("project is required and must be a string.");
  }
  return { ok: true, args: { project: args.project } };
}

function fromOutcome(command: string, outcome: RunStorageOutcome): OmgResponse {
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

function validationError(message: string): { ok: false; response: OmgResponse } {
  return {
    ok: false,
    response: {
      ok: false,
      command: "storage:audit",
      error: { code: "VALIDATION_ERROR", message, recoverable: true },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
