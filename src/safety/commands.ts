import { classifyOperation, type OperationContext, type OperationIntent } from "./intent.js";

export type CommandName =
  | "auth:context"
  | "auth:list"
  | "budget:audit"
  | "budget:ensure"
  | "budget:notifications:audit"
  | "budget:notifications:ensure"
  | "budget:enable-api"
  | "cost:status"
  | "cost:lock"
  | "cost:unlock"
  | "deploy"
  | "doctor"
  | "firebase:deploy"
  | "firestore:audit"
  | "iam:audit"
  | "init"
  | "link"
  | "mcp:gateway:audit"
  | "mcp:gateway:call"
  | "project:audit"
  | "project:cleanup"
  | "project:delete"
  | "project:undelete"
  | "secret:list"
  | "secret:set"
  | "secret:delete"
  | "security:audit"
  | "sql:audit"
  | "storage:audit";

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
  "omg.mcp.gateway.audit": "mcp:gateway:audit",
  "omg.mcp.gateway.call": "mcp:gateway:call",
  "omg.project.audit": "project:audit",
  "omg.project.cleanup": "project:cleanup",
  "omg.project.delete": "project:delete",
  "omg.project.undelete": "project:undelete",
  "omg.secret.list": "secret:list",
  "omg.secret.set": "secret:set",
  "omg.secret.delete": "secret:delete",
  "omg.security.audit": "security:audit",
  "omg.sql.audit": "sql:audit",
  "omg.storage.audit": "storage:audit",
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
    case "budget:ensure":
      return ["billing.audit", "budget.ensure"];
    case "budget:notifications:audit":
      return ["billing.audit", "budget.notifications.audit", "pubsub.topic.audit"];
    case "budget:notifications:ensure":
      return ["billing.audit", "pubsub.topic.audit", "budget.notifications.ensure"];
    case "budget:enable-api":
      return ["budget.enable-api"];
    case "cost:status":
      return ["cost.status"];
    case "cost:lock":
      return ["cost.lock"];
    case "cost:unlock":
      return ["cost.unlock"];
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
    case "mcp:gateway:audit":
      return ["downstream.mcp.discover"];
    case "mcp:gateway:call":
      return ["downstream.mcp.read"];
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
    case "sql:audit":
      return ["sql.audit"];
    case "storage:audit":
      return ["storage.audit"];
  }
}

function getCommandNotes(command: CommandName): string[] {
  switch (command) {
    case "budget:enable-api":
      return ["Budget API enablement is a bootstrap exception for budget visibility."];
    case "budget:ensure":
      return ["Budget ensure starts as dry-run policy planning; live mutation needs explicit executor support and post-verification."];
    case "budget:notifications:ensure":
      return ["Budget notification ensure starts as dry-run routing planning; live mutation needs explicit executor support and post-verification."];
    case "cost:lock":
      return ["Cost lock only writes local .omg state and blocks future omg cost-bearing live operations."];
    case "cost:unlock":
      return ["Cost unlock restores future omg cost-bearing live operations and requires explicit confirmation."];
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
