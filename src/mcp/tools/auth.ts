import { runAuthContext } from "../../cli/auth.js";
import type { OmgResponse } from "./types.js";

export const authContextTool = {
  name: "omg.auth.context",
  description: "Read active gcloud configuration, account, project, and ADC account context.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

export async function handleAuthContext(args: unknown): Promise<OmgResponse> {
  if (!isRecord(args) || Object.keys(args).length > 0) {
    return {
      ok: false,
      command: "auth:context",
      error: {
        code: "VALIDATION_ERROR",
        message: "Arguments must be an empty object.",
        recoverable: true,
      },
    };
  }

  const outcome = await runAuthContext();
  return {
    ok: true,
    command: "auth:context",
    data: { ...outcome.data },
    next: outcome.next,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
