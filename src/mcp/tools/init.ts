import { runInit, type RunInitInput } from "../../cli/commands/init.js";
import type { OmgResponse } from "./types.js";

const environments = ["local", "dev", "staging", "prod"] as const;

export const initTool = {
  name: "omg.init",
  description: "Initialize a GCP project, billing link, trust profile, and local config.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      billingAccount: { type: "string" },
      environment: { type: "string", enum: ["local", "dev", "staging", "prod"] },
      region: { type: "string" },
    },
    required: ["projectId", "billingAccount", "environment", "region"],
    additionalProperties: false,
  },
};

export async function handleInit(args: unknown): Promise<OmgResponse> {
  const parsed = parseArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  const outcome = await runInit({
    cwd: process.cwd(),
    jsonMode: true,
    interactive: false,
    ...parsed.args,
  });

  if (outcome.ok) {
    return {
      ok: true,
      command: "init",
      data: { ...outcome.data },
      next: outcome.next,
    };
  }

  return {
    ok: false,
    command: "init",
    data: outcome.error.data,
    error: {
      code: outcome.error.code,
      message: outcome.error.message,
      recoverable: outcome.error.recoverable,
      hint: outcome.error.hint,
    },
  };
}

function parseArgs(
  args: unknown,
):
  | { ok: true; args: Pick<RunInitInput, "projectId" | "billingAccount" | "environment" | "region"> }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("Arguments must be an object.");
  }

  for (const key of Object.keys(args)) {
    if (key !== "projectId" && key !== "billingAccount" && key !== "environment" && key !== "region") {
      return validationError(`Unknown argument: ${key}.`);
    }
  }

  const missing = ["projectId", "billingAccount", "environment", "region"].filter(
    (key) => typeof args[key] !== "string" || args[key] === "",
  );
  if (missing.length > 0) {
    return validationError("Missing required arguments.", { missing });
  }

  if (!isEnvironment(args.environment)) {
    return validationError("environment must be one of local, dev, staging, or prod.");
  }

  return {
    ok: true,
    args: {
      projectId: args.projectId as string,
      billingAccount: args.billingAccount as string,
      environment: args.environment,
      region: args.region as string,
    },
  };
}

function isEnvironment(value: unknown): value is NonNullable<RunInitInput["environment"]> {
  return typeof value === "string" && environments.includes(value as NonNullable<RunInitInput["environment"]>);
}

function validationError(
  message: string,
  data?: Record<string, unknown>,
): { ok: false; response: OmgResponse } {
  return {
    ok: false,
    response: {
      ok: false,
      command: "init",
      data,
      error: { code: "VALIDATION_ERROR", message, recoverable: true },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
