import { runIamAudit, type RunIamOutcome } from "../../cli/commands/iam.js";
import type { OmgResponse } from "./types.js";

export const iamAuditTool = {
  name: "omg.iam.audit",
  description: "Read-only IAM policy and service account audit for a Google Cloud project.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
    },
    required: ["project"],
    additionalProperties: false,
  },
};

export async function handleIamAudit(args: unknown): Promise<OmgResponse> {
  const parsed = parseAuditArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome("iam:audit", await runIamAudit(parsed.args));
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

function fromOutcome(command: string, outcome: RunIamOutcome): OmgResponse {
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
      command: "iam:audit",
      error: { code: "VALIDATION_ERROR", message, recoverable: true },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
