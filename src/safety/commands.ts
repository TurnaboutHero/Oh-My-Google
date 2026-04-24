import { classifyOperation, type OperationContext, type OperationIntent } from "./intent.js";

export type CommandName =
  | "auth:context"
  | "auth:list"
  | "budget:audit"
  | "budget:enable-api"
  | "deploy"
  | "doctor"
  | "firebase:deploy"
  | "firestore:audit"
  | "iam:audit"
  | "init"
  | "link"
  | "project:audit"
  | "project:cleanup"
  | "project:delete"
  | "project:undelete"
  | "secret:list"
  | "secret:set"
  | "secret:delete"
  | "security:audit";

export type SurfaceKind = "cli" | "mcp";

export interface CommandIntentContext extends OperationContext {
  deployTarget?: "cloud-run" | "firebase-hosting";
}

export interface CommandIntentPlan {
  command: CommandName;
  intents: OperationIntent[];
  notes: string[];
}

const MCP_COMMANDS: Record<string, CommandName> = {
  "omg.auth.context": "auth:context",
  "omg.approvals.list": "auth:list",
  "omg.budget.audit": "budget:audit",
  "omg.deploy": "deploy",
  "omg.doctor": "doctor",
  "omg.firestore.audit": "firestore:audit",
  "omg.iam.audit": "iam:audit",
  "omg.init": "init",
  "omg.link": "link",
  "omg.project.audit": "project:audit",
  "omg.project.cleanup": "project:cleanup",
  "omg.project.delete": "project:delete",
  "omg.project.undelete": "project:undelete",
  "omg.secret.list": "secret:list",
  "omg.secret.set": "secret:set",
  "omg.secret.delete": "secret:delete",
  "omg.security.audit": "security:audit",
};

export function classifySurfaceCommand(
  surface: SurfaceKind,
  command: string,
  context: CommandIntentContext = {},
): CommandIntentPlan {
  return classifyCommand(normalizeCommand(surface, command), context);
}

export function classifyCommand(
  command: CommandName,
  context: CommandIntentContext = {},
): CommandIntentPlan {
  const operationIds = getCommandOperationIds(command, context);
  return {
    command,
    intents: operationIds.map((operationId) => classifyOperation(operationId, context)),
    notes: getCommandNotes(command),
  };
}

function normalizeCommand(surface: SurfaceKind, command: string): CommandName {
  if (surface === "mcp") {
    const mapped = MCP_COMMANDS[command];
    if (!mapped) {
      throw new Error(`Unknown MCP command: ${command}`);
    }
    return mapped;
  }

  return command as CommandName;
}

function getCommandOperationIds(
  command: CommandName,
  context: CommandIntentContext,
): string[] {
  switch (command) {
    case "auth:context":
    case "auth:list":
      return ["gcp.auth.status"];
    case "budget:audit":
      return ["billing.audit"];
    case "budget:enable-api":
      return ["budget.enable-api"];
    case "deploy":
      return [context.deployTarget === "firebase-hosting" ? "deploy.firebase-hosting" : "deploy.cloud-run"];
    case "doctor":
      return ["doctor.run"];
    case "firebase:deploy":
      return ["deploy.firebase-hosting"];
    case "firestore:audit":
      return ["firestore.audit"];
    case "iam:audit":
      return ["iam.audit"];
    case "init":
      return ["billing.audit", "billing.link", "apis.enable", "iam.role.grant"];
    case "link":
      return ["planner.detect"];
    case "project:audit":
      return ["project.audit"];
    case "project:cleanup":
      return ["project.cleanup.plan"];
    case "project:delete":
      return ["project.audit", "gcp.project.delete"];
    case "project:undelete":
      return ["gcp.project.undelete"];
    case "secret:list":
      return ["secret.list"];
    case "secret:set":
      return ["secret.set"];
    case "secret:delete":
      return ["secret.delete"];
    case "security:audit":
      return ["security.audit"];
  }
}

function getCommandNotes(command: CommandName): string[] {
  switch (command) {
    case "budget:enable-api":
      return ["Budget API enablement is a bootstrap exception for budget visibility."];
    case "init":
      return ["Init is a multi-action setup flow; budget audit must run before billing link/API/IAM writes."];
    case "project:delete":
      return ["Project delete must pass read-only audit before approval-gated lifecycle execution."];
    case "project:undelete":
      return ["Project undelete must verify DELETE_REQUESTED state before approval-gated lifecycle execution."];
    default:
      return [];
  }
}
