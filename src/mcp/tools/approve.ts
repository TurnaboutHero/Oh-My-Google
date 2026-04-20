import { runApprove } from "../../cli/commands/approve.js";
import type { OmgResponse } from "./types.js";

export const approveTool = {
  name: "omg.approve",
  description: "Approve a pending manual approval request.",
  inputSchema: {
    type: "object",
    properties: {
      approvalId: { type: "string" },
      reason: { type: "string" },
      approver: { type: "string" },
    },
    required: ["approvalId"],
    additionalProperties: false,
  },
};

export async function handleApprove(args: unknown): Promise<OmgResponse> {
  const parsed = parseArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  const outcome = await runApprove({ cwd: process.cwd(), ...parsed.args });
  if (outcome.ok) {
    return {
      ok: true,
      command: "approve",
      data: { ...outcome.data },
      next: outcome.next,
    };
  }

  return {
    ok: false,
    command: "approve",
    data:
      outcome.error.code === "APPROVAL_ALREADY_FINALIZED"
        ? { status: outcome.error.status }
        : undefined,
    error: {
      code: outcome.error.code,
      message: outcome.error.message,
      recoverable: true,
    },
  };
}

function parseArgs(
  args: unknown,
):
  | { ok: true; args: { approvalId: string; reason?: string; approver?: string } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("Arguments must be an object.");
  }

  for (const key of Object.keys(args)) {
    if (key !== "approvalId" && key !== "reason" && key !== "approver") {
      return validationError(`Unknown argument: ${key}.`);
    }
  }

  if (typeof args.approvalId !== "string") {
    return validationError("approvalId must be a string.");
  }
  if (args.reason !== undefined && typeof args.reason !== "string") {
    return validationError("reason must be a string.");
  }
  if (args.approver !== undefined && typeof args.approver !== "string") {
    return validationError("approver must be a string.");
  }

  return {
    ok: true,
    args: {
      approvalId: args.approvalId,
      reason: args.reason,
      approver: args.approver,
    },
  };
}

function validationError(message: string): { ok: false; response: OmgResponse } {
  return {
    ok: false,
    response: {
      ok: false,
      command: "approve",
      error: { code: "VALIDATION_ERROR", message, recoverable: true },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
