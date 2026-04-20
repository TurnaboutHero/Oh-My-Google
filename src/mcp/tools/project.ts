import {
  runProjectAudit,
  runProjectCleanup,
  runProjectDelete,
  runProjectUndelete,
  type RunProjectOutcome,
} from "../../cli/commands/project.js";
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

export const projectDeleteTool = {
  name: "omg.project.delete",
  description: "Request or consume approval for Google Cloud project deletion.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
      approval: { type: "string" },
      expectAccount: { type: "string" },
    },
    required: ["project"],
    additionalProperties: false,
  },
};

export const projectUndeleteTool = {
  name: "omg.project.undelete",
  description: "Request or consume approval for Google Cloud project undeletion.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
      approval: { type: "string" },
      expectAccount: { type: "string" },
    },
    required: ["project"],
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

export async function handleProjectDelete(args: unknown): Promise<OmgResponse> {
  const parsed = parseDeleteArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome("project:delete", await runProjectDelete({
    cwd: process.cwd(),
    ...parsed.args,
  }));
}

export async function handleProjectUndelete(args: unknown): Promise<OmgResponse> {
  const parsed = parseUndeleteArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome("project:undelete", await runProjectUndelete({
    cwd: process.cwd(),
    ...parsed.args,
  }));
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

function parseDeleteArgs(args: unknown):
  | { ok: true; args: { project: string; approval?: string; expectedAccount?: string } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("project:delete", "Arguments must be an object.");
  }
  for (const key of Object.keys(args)) {
    if (key !== "project" && key !== "approval" && key !== "expectAccount") {
      return validationError("project:delete", `Unknown argument: ${key}.`);
    }
  }
  if (typeof args.project !== "string") {
    return validationError("project:delete", "project is required and must be a string.");
  }
  if (args.approval !== undefined && typeof args.approval !== "string") {
    return validationError("project:delete", "approval must be a string.");
  }
  if (args.expectAccount !== undefined && typeof args.expectAccount !== "string") {
    return validationError("project:delete", "expectAccount must be a string.");
  }
  return {
    ok: true,
    args: {
      project: args.project,
      approval: args.approval,
      expectedAccount: args.expectAccount,
    },
  };
}

function parseUndeleteArgs(args: unknown):
  | { ok: true; args: { project: string; approval?: string; expectedAccount?: string } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("project:undelete", "Arguments must be an object.");
  }
  for (const key of Object.keys(args)) {
    if (key !== "project" && key !== "approval" && key !== "expectAccount") {
      return validationError("project:undelete", `Unknown argument: ${key}.`);
    }
  }
  if (typeof args.project !== "string") {
    return validationError("project:undelete", "project is required and must be a string.");
  }
  if (args.approval !== undefined && typeof args.approval !== "string") {
    return validationError("project:undelete", "approval must be a string.");
  }
  if (args.expectAccount !== undefined && typeof args.expectAccount !== "string") {
    return validationError("project:undelete", "expectAccount must be a string.");
  }
  return {
    ok: true,
    args: {
      project: args.project,
      approval: args.approval,
      expectedAccount: args.expectAccount,
    },
  };
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
