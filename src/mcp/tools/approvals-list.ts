import { listApprovals, validateStatus } from "../../approval/queue.js";
import type { ApprovalListFilter } from "../../approval/types.js";
import { OmgError } from "../../types/errors.js";
import type { OmgResponse } from "./types.js";

export const approvalsListTool = {
  name: "omg.approvals.list",
  description: "List manual approval requests.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string" },
      action: { type: "string" },
    },
    additionalProperties: false,
  },
};

export async function handleApprovalsList(args: unknown): Promise<OmgResponse> {
  const parsed = parseArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  const filter: ApprovalListFilter = {};

  if (parsed.args.status) {
    try {
      filter.status = validateStatus(parsed.args.status);
    } catch (error) {
      return {
        ok: false,
        command: "approvals.list",
        error: {
          code: "INVALID_STATUS",
          message: error instanceof Error ? error.message : "Invalid approval status.",
          recoverable: true,
        },
      };
    }
  }

  if (parsed.args.action) {
    filter.action = parsed.args.action;
  }

  try {
    const approvals = await listApprovals(process.cwd(), filter);
    return { ok: true, command: "approvals.list", data: { approvals } };
  } catch (error) {
    const code = error instanceof OmgError ? error.code : "APPROVALS_LIST_FAILED";
    const recoverable = error instanceof OmgError ? error.recoverable : false;
    return {
      ok: false,
      command: "approvals.list",
      error: {
        code,
        message: error instanceof Error ? error.message : "Unknown approvals error.",
        recoverable,
      },
    };
  }
}

function parseArgs(
  args: unknown,
):
  | { ok: true; args: { status?: string; action?: string } }
  | { ok: false; response: OmgResponse } {
  if (args === undefined) {
    return { ok: true, args: {} };
  }

  if (!isRecord(args)) {
    return validationError("Arguments must be an object.");
  }

  for (const key of Object.keys(args)) {
    if (key !== "status" && key !== "action") {
      return validationError(`Unknown argument: ${key}.`);
    }
  }

  if (args.status !== undefined && typeof args.status !== "string") {
    return validationError("status must be a string.");
  }
  if (args.action !== undefined && typeof args.action !== "string") {
    return validationError("action must be a string.");
  }

  return { ok: true, args: { status: args.status, action: args.action } };
}

function validationError(message: string): { ok: false; response: OmgResponse } {
  return {
    ok: false,
    response: {
      ok: false,
      command: "approvals.list",
      error: { code: "VALIDATION_ERROR", message, recoverable: true },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
