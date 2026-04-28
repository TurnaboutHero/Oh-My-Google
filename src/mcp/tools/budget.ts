import {
  runBudgetAudit,
  runBudgetEnsure,
  runBudgetNotificationsAudit,
  runBudgetNotificationsEnsure,
  runBudgetNotificationsLockIngestion,
  type RunBudgetOutcome,
} from "../../cli/commands/budget.js";
import type { OmgResponse } from "./types.js";

export const budgetAuditTool = {
  name: "omg.budget.audit",
  description: "Read-only billing budget guard audit for a Google Cloud project.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
    },
    required: ["project"],
    additionalProperties: false,
  },
};

export const budgetEnsureTool = {
  name: "omg.budget.ensure",
  description: "Dry-run expected billing budget policy. Live budget mutation remains blocked.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
      amount: { type: ["string", "number"] },
      currency: { type: "string" },
      thresholds: { type: ["string", "array"], items: { type: "number" } },
      displayName: { type: "string" },
      dryRun: { type: "boolean" },
      yes: { type: "boolean" },
      approval: { type: "string" },
    },
    required: ["project", "amount", "currency"],
    additionalProperties: false,
  },
};

export const budgetNotificationsAuditTool = {
  name: "omg.budget.notifications.audit",
  description: "Read-only audit of visible budget Pub/Sub notification routing.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
      topic: { type: "string" },
    },
    required: ["project"],
    additionalProperties: false,
  },
};

export const budgetNotificationsEnsureTool = {
  name: "omg.budget.notifications.ensure",
  description: "Dry-run expected budget Pub/Sub notification routing. Live mutation remains blocked.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
      topic: { type: "string" },
      displayName: { type: "string" },
      dryRun: { type: "boolean" },
      yes: { type: "boolean" },
    },
    required: ["project", "topic"],
    additionalProperties: false,
  },
};

export const budgetNotificationsLockIngestionTool = {
  name: "omg.budget.notifications.lock_ingestion",
  description: "Dry-run Budget Pub/Sub alert to local cost lock ingestion setup. Live setup remains blocked.",
  inputSchema: {
    type: "object",
    properties: {
      project: { type: "string" },
      topic: { type: "string" },
      displayName: { type: "string" },
      dryRun: { type: "boolean" },
      yes: { type: "boolean" },
    },
    required: ["project", "topic"],
    additionalProperties: false,
  },
};

export async function handleBudgetAudit(args: unknown): Promise<OmgResponse> {
  const parsed = parseAuditArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome("budget:audit", await runBudgetAudit(parsed.args));
}

export async function handleBudgetEnsure(args: unknown): Promise<OmgResponse> {
  const parsed = parseEnsureArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome("budget:ensure", await runBudgetEnsure(parsed.args));
}

export async function handleBudgetNotificationsAudit(args: unknown): Promise<OmgResponse> {
  const parsed = parseNotificationsAuditArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome("budget:notifications:audit", await runBudgetNotificationsAudit(parsed.args));
}

export async function handleBudgetNotificationsEnsure(args: unknown): Promise<OmgResponse> {
  const parsed = parseNotificationsEnsureArgs(args, "budget:notifications:ensure");
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome("budget:notifications:ensure", await runBudgetNotificationsEnsure(parsed.args));
}

export async function handleBudgetNotificationsLockIngestion(args: unknown): Promise<OmgResponse> {
  const parsed = parseNotificationsEnsureArgs(args, "budget:notifications:lock-ingestion");
  if (!parsed.ok) {
    return parsed.response;
  }

  return fromOutcome(
    "budget:notifications:lock-ingestion",
    await runBudgetNotificationsLockIngestion(parsed.args),
  );
}

function parseAuditArgs(args: unknown):
  | { ok: true; args: { project: string } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("budget:audit", "Arguments must be an object.");
  }
  for (const key of Object.keys(args)) {
    if (key !== "project") {
      return validationError("budget:audit", `Unknown argument: ${key}.`);
    }
  }
  if (typeof args.project !== "string") {
    return validationError("budget:audit", "project is required and must be a string.");
  }
  return { ok: true, args: { project: args.project } };
}

function parseEnsureArgs(args: unknown):
  | {
      ok: true;
      args: {
        project: string;
        amount: string | number;
        currency: string;
        thresholds?: string | number[];
        displayName?: string;
        dryRun?: boolean;
        yes?: boolean;
        approval?: string;
      };
    }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("budget:ensure", "Arguments must be an object.");
  }

  const allowed = ["project", "amount", "currency", "thresholds", "displayName", "dryRun", "yes", "approval"];
  const unknown = findUnknownKey(args, allowed);
  if (unknown) {
    return validationError("budget:ensure", `Unknown argument: ${unknown}.`);
  }
  if (typeof args.project !== "string") {
    return validationError("budget:ensure", "project is required and must be a string.");
  }
  if (typeof args.amount !== "string" && typeof args.amount !== "number") {
    return validationError("budget:ensure", "amount is required and must be a string or number.");
  }
  if (typeof args.currency !== "string") {
    return validationError("budget:ensure", "currency is required and must be a string.");
  }
  if (args.thresholds !== undefined && !isThresholds(args.thresholds)) {
    return validationError("budget:ensure", "thresholds must be a comma-separated string or number array.");
  }
  if (args.displayName !== undefined && typeof args.displayName !== "string") {
    return validationError("budget:ensure", "displayName must be a string.");
  }
  if (args.dryRun !== undefined && typeof args.dryRun !== "boolean") {
    return validationError("budget:ensure", "dryRun must be a boolean.");
  }
  if (args.yes !== undefined && typeof args.yes !== "boolean") {
    return validationError("budget:ensure", "yes must be a boolean.");
  }
  if (args.approval !== undefined && typeof args.approval !== "string") {
    return validationError("budget:ensure", "approval must be a string.");
  }

  return {
    ok: true,
    args: {
      project: args.project,
      amount: args.amount,
      currency: args.currency,
      thresholds: args.thresholds,
      displayName: args.displayName,
      dryRun: args.dryRun,
      yes: args.yes,
      approval: args.approval,
    },
  };
}

function parseNotificationsAuditArgs(args: unknown):
  | { ok: true; args: { project: string; topic?: string } }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("budget:notifications:audit", "Arguments must be an object.");
  }
  const unknown = findUnknownKey(args, ["project", "topic"]);
  if (unknown) {
    return validationError("budget:notifications:audit", `Unknown argument: ${unknown}.`);
  }
  if (typeof args.project !== "string") {
    return validationError("budget:notifications:audit", "project is required and must be a string.");
  }
  if (args.topic !== undefined && typeof args.topic !== "string") {
    return validationError("budget:notifications:audit", "topic must be a string.");
  }
  return { ok: true, args: { project: args.project, topic: args.topic } };
}

function parseNotificationsEnsureArgs(
  args: unknown,
  command: "budget:notifications:ensure" | "budget:notifications:lock-ingestion",
):
  | {
      ok: true;
      args: {
        project: string;
        topic: string;
        displayName?: string;
        dryRun?: boolean;
        yes?: boolean;
      };
    }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError(command, "Arguments must be an object.");
  }
  const unknown = findUnknownKey(args, ["project", "topic", "displayName", "dryRun", "yes"]);
  if (unknown) {
    return validationError(command, `Unknown argument: ${unknown}.`);
  }
  if (typeof args.project !== "string") {
    return validationError(command, "project is required and must be a string.");
  }
  if (typeof args.topic !== "string") {
    return validationError(command, "topic is required and must be a string.");
  }
  if (args.displayName !== undefined && typeof args.displayName !== "string") {
    return validationError(command, "displayName must be a string.");
  }
  if (args.dryRun !== undefined && typeof args.dryRun !== "boolean") {
    return validationError(command, "dryRun must be a boolean.");
  }
  if (args.yes !== undefined && typeof args.yes !== "boolean") {
    return validationError(command, "yes must be a boolean.");
  }

  return {
    ok: true,
    args: {
      project: args.project,
      topic: args.topic,
      displayName: args.displayName,
      dryRun: args.dryRun,
      yes: args.yes,
    },
  };
}

function fromOutcome(command: string, outcome: RunBudgetOutcome): OmgResponse {
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

function findUnknownKey(args: Record<string, unknown>, allowed: string[]): string | undefined {
  return Object.keys(args).find((key) => !allowed.includes(key));
}

function isThresholds(value: unknown): value is string | number[] {
  return typeof value === "string" || (Array.isArray(value) && value.every((entry) => typeof entry === "number"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
