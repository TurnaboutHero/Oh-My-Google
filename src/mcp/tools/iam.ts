import {
  runIamAudit,
  runIamBootstrap,
  runIamPlan,
  type RunIamOutcome,
} from "../../cli/commands/iam.js";
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

export const iamPlanTool = {
  name: "omg.iam.plan",
  description: "Plan separated agent IAM identities without applying grants.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
      prefix: { type: "string" },
    },
    required: ["project"],
    additionalProperties: false,
  },
};

export const iamBootstrapTool = {
  name: "omg.iam.bootstrap",
  description: "Dry-run separated agent IAM bootstrap steps. Live IAM mutation remains blocked.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
      prefix: { type: "string" },
      dryRun: { type: "boolean" },
      yes: { type: "boolean" },
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

export async function handleIamPlan(args: unknown): Promise<OmgResponse> {
  const parsed = parsePlanArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome("iam:plan", await runIamPlan(parsed.args));
}

export async function handleIamBootstrap(args: unknown): Promise<OmgResponse> {
  const parsed = parseBootstrapArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome("iam:bootstrap", await runIamBootstrap(parsed.args));
}

function parseAuditArgs(args: unknown):
  | { ok: true; args: { project: string } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("iam:audit", "Arguments must be an object.");
  }
  for (const key of Object.keys(args)) {
    if (key !== "project") {
      return validationError("iam:audit", `Unknown argument: ${key}.`);
    }
  }
  if (typeof args.project !== "string") {
    return validationError("iam:audit", "project is required and must be a string.");
  }
  return { ok: true, args: { project: args.project } };
}

function parsePlanArgs(args: unknown):
  | { ok: true; args: { project: string; prefix?: string } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("iam:plan", "Arguments must be an object.");
  }
  const unknown = Object.keys(args).find((key) => key !== "project" && key !== "prefix");
  if (unknown) {
    return validationError("iam:plan", `Unknown argument: ${unknown}.`);
  }
  if (typeof args.project !== "string") {
    return validationError("iam:plan", "project is required and must be a string.");
  }
  if (args.prefix !== undefined && typeof args.prefix !== "string") {
    return validationError("iam:plan", "prefix must be a string.");
  }
  return { ok: true, args: { project: args.project, prefix: args.prefix } };
}

function parseBootstrapArgs(args: unknown):
  | { ok: true; args: { project: string; prefix?: string; dryRun?: boolean; yes?: boolean } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("iam:bootstrap", "Arguments must be an object.");
  }
  const unknown = Object.keys(args).find((key) =>
    key !== "project" && key !== "prefix" && key !== "dryRun" && key !== "yes");
  if (unknown) {
    return validationError("iam:bootstrap", `Unknown argument: ${unknown}.`);
  }
  if (typeof args.project !== "string") {
    return validationError("iam:bootstrap", "project is required and must be a string.");
  }
  if (args.prefix !== undefined && typeof args.prefix !== "string") {
    return validationError("iam:bootstrap", "prefix must be a string.");
  }
  if (args.dryRun !== undefined && typeof args.dryRun !== "boolean") {
    return validationError("iam:bootstrap", "dryRun must be a boolean.");
  }
  if (args.yes !== undefined && typeof args.yes !== "boolean") {
    return validationError("iam:bootstrap", "yes must be a boolean.");
  }
  return {
    ok: true,
    args: {
      project: args.project,
      prefix: args.prefix,
      dryRun: args.dryRun,
      yes: args.yes,
    },
  };
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
