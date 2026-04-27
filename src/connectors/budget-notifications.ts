import type {
  BillingBudgetNotificationsRule,
  BillingBudgetSummary,
  BillingGuardAudit,
} from "./billing-audit.js";
import type { PubsubTopicAudit } from "./pubsub-topic-audit.js";
import { ValidationError } from "../types/errors.js";

export type BudgetNotificationPosture = "configured" | "partial" | "none" | "blocked";
export type BudgetNotificationEnsureAction = "none" | "update" | "blocked";

export interface BudgetNotificationPolicyInput {
  projectId: string;
  pubsubTopic: string;
  targetBudgetDisplayName: string;
}

export interface DesiredBudgetNotificationRule {
  pubsubTopic: string;
  schemaVersion: "1.0";
  monitoringNotificationChannels?: string[];
  disableDefaultIamRecipients?: boolean;
  enableProjectLevelRecipients?: boolean;
}

export interface BudgetNotificationBudgetStatus {
  name: string;
  displayName: string;
  pubsubTopic?: string;
  schemaVersion?: string;
  status: Exclude<BudgetNotificationPosture, "blocked">;
  issue?: string;
}

export interface BudgetNotificationsAudit {
  projectId: string;
  billingAccountId?: string;
  posture: BudgetNotificationPosture;
  budgetCount: number;
  configuredBudgetCount: number;
  budgets: BudgetNotificationBudgetStatus[];
  topicAudit?: PubsubTopicAudit;
  blockers: string[];
  recommendedAction: string;
}

export interface BudgetNotificationEnsurePlan {
  projectId: string;
  billingAccountId?: string;
  dryRun: true;
  targetBudgetDisplayName: string;
  desiredRule: DesiredBudgetNotificationRule;
  topicAudit?: PubsubTopicAudit;
  existingBudgetCount: number;
  matchedBudget?: BillingBudgetSummary;
  action: BudgetNotificationEnsureAction;
  changes: string[];
  blockers: string[];
  recommendedAction: string;
}

export interface BudgetNotificationApiMutationPlan {
  action: BudgetNotificationEnsureAction;
  name?: string;
  updateMask?: string[];
  budget?: {
    name: string;
    notificationsRule: DesiredBudgetNotificationRule;
  };
  blockers: string[];
}

export interface BudgetNotificationPostVerification {
  verified: boolean;
  action: BudgetNotificationEnsureAction;
  matchedBudget?: BillingBudgetSummary;
  remainingChanges: string[];
  blockers: string[];
}

export function parseBudgetNotificationPolicyInput(input: {
  project?: string;
  topic?: string;
  displayName?: string;
}): BudgetNotificationPolicyInput {
  const projectId = normalizeProjectId(input.project);
  return {
    projectId,
    pubsubTopic: normalizePubsubTopic(projectId, input.topic),
    targetBudgetDisplayName: normalizeDisplayName(input.displayName) ?? `omg budget guard: ${projectId}`,
  };
}

export function auditBudgetNotificationPosture(
  audit: BillingGuardAudit,
  topicAudit?: PubsubTopicAudit,
): BudgetNotificationsAudit {
  const blockers = getAuditBlockers(audit);
  const budgets = audit.budgets.map(toBudgetNotificationStatus);
  const configuredBudgetCount = budgets.filter((budget) => budget.status === "configured").length;

  if (blockers.length > 0) {
    return {
      projectId: audit.projectId,
      billingAccountId: audit.billingAccountId,
      posture: "blocked",
      budgetCount: audit.budgets.length,
      configuredBudgetCount,
      budgets,
      topicAudit,
      blockers,
      recommendedAction: "Resolve budget audit blockers before evaluating budget notification routing.",
    };
  }

  const topicBlockers = getTopicAuditBlockers(topicAudit);
  const posture = topicBlockers.length > 0 ? "blocked" : getPosture(budgets);
  return {
    projectId: audit.projectId,
    billingAccountId: audit.billingAccountId,
    posture,
    budgetCount: audit.budgets.length,
    configuredBudgetCount,
    budgets,
    topicAudit,
    blockers: topicBlockers,
    recommendedAction: getRecommendedAction(posture),
  };
}

export function planBudgetNotificationEnsure(
  audit: BillingGuardAudit,
  input: BudgetNotificationPolicyInput,
  topicAudit?: PubsubTopicAudit,
): BudgetNotificationEnsurePlan {
  const matchedBudget = audit.budgets.find((budget) => budget.displayName === input.targetBudgetDisplayName);
  const desiredRule = buildDesiredRule(input.pubsubTopic, matchedBudget?.notificationsRule);
  const base = {
    projectId: input.projectId,
    billingAccountId: audit.billingAccountId,
    dryRun: true as const,
    targetBudgetDisplayName: input.targetBudgetDisplayName,
    desiredRule,
    topicAudit,
    existingBudgetCount: audit.budgets.length,
  };
  const blockers = [...getAuditBlockers(audit), ...getTopicAuditBlockers(topicAudit)];
  if (blockers.length > 0) {
    return {
      ...base,
      matchedBudget,
      action: "blocked",
      changes: [],
      blockers,
      recommendedAction: "Resolve budget audit blockers before connecting Pub/Sub notifications.",
    };
  }

  if (!matchedBudget) {
    return {
      ...base,
      action: "blocked",
      changes: [],
      blockers: [`No visible budget named ${input.targetBudgetDisplayName}.`],
      recommendedAction: "Create or dry-run the expected budget policy before connecting Pub/Sub notifications.",
    };
  }

  const changes = getNotificationChanges(matchedBudget, desiredRule);
  if (changes.length === 0) {
    return {
      ...base,
      matchedBudget,
      action: "none",
      changes: [],
      blockers: [],
      recommendedAction: "Expected Pub/Sub budget notification routing is already visible.",
    };
  }

  return {
    ...base,
    matchedBudget,
    action: "update",
    changes,
    blockers: [],
    recommendedAction: "Update the budget notification rule to connect the expected Pub/Sub topic.",
  };
}

export function planBudgetNotificationApiMutation(
  plan: BudgetNotificationEnsurePlan,
): BudgetNotificationApiMutationPlan {
  if (plan.action === "blocked") {
    return {
      action: "blocked",
      blockers: plan.blockers,
    };
  }

  if (plan.action === "none") {
    return {
      action: "none",
      blockers: [],
    };
  }

  if (!plan.matchedBudget?.name) {
    return {
      action: "blocked",
      blockers: ["Matched budget resource name is missing."],
    };
  }

  return {
    action: "update",
    name: plan.matchedBudget.name,
    updateMask: ["notificationsRule"],
    budget: {
      name: plan.matchedBudget.name,
      notificationsRule: plan.desiredRule,
    },
    blockers: [],
  };
}

export function verifyBudgetNotificationPostState(
  audit: BillingGuardAudit,
  input: BudgetNotificationPolicyInput,
): BudgetNotificationPostVerification {
  const plan = planBudgetNotificationEnsure(audit, input);
  return {
    verified: plan.action === "none",
    action: plan.action,
    matchedBudget: plan.matchedBudget,
    remainingChanges: plan.changes,
    blockers: plan.blockers,
  };
}

function toBudgetNotificationStatus(budget: BillingBudgetSummary): BudgetNotificationBudgetStatus {
  const rule = budget.notificationsRule;
  if (!rule?.pubsubTopic && !rule?.schemaVersion) {
    return {
      name: budget.name,
      displayName: budget.displayName,
      status: "none",
      issue: "No Pub/Sub notification topic is configured.",
    };
  }

  if (rule.pubsubTopic && rule.schemaVersion === "1.0") {
    return {
      name: budget.name,
      displayName: budget.displayName,
      pubsubTopic: rule.pubsubTopic,
      schemaVersion: rule.schemaVersion,
      status: "configured",
    };
  }

  return {
    name: budget.name,
    displayName: budget.displayName,
    pubsubTopic: rule.pubsubTopic,
    schemaVersion: rule.schemaVersion,
    status: "partial",
    issue: "Pub/Sub notification rule is incomplete or uses an unsupported schema version.",
  };
}

function getPosture(budgets: BudgetNotificationBudgetStatus[]): BudgetNotificationPosture {
  if (budgets.length === 0 || budgets.every((budget) => budget.status === "none")) {
    return "none";
  }
  if (budgets.every((budget) => budget.status === "configured")) {
    return "configured";
  }
  return "partial";
}

function getRecommendedAction(posture: BudgetNotificationPosture): string {
  switch (posture) {
    case "configured":
      return "Budget Pub/Sub notification routing is configured for all visible budgets.";
    case "partial":
      return "Review budgets with missing or incomplete Pub/Sub notification routing.";
    case "none":
      return "Connect a Pub/Sub topic to the expected budget before adding external notification senders.";
    case "blocked":
      return "Resolve budget audit blockers before evaluating budget notification routing.";
  }
}

function buildDesiredRule(
  pubsubTopic: string,
  existingRule: BillingBudgetNotificationsRule | undefined,
): DesiredBudgetNotificationRule {
  return {
    pubsubTopic,
    schemaVersion: "1.0",
    ...(existingRule?.monitoringNotificationChannels
      ? { monitoringNotificationChannels: existingRule.monitoringNotificationChannels }
      : {}),
    ...(typeof existingRule?.disableDefaultIamRecipients === "boolean"
      ? { disableDefaultIamRecipients: existingRule.disableDefaultIamRecipients }
      : {}),
    ...(typeof existingRule?.enableProjectLevelRecipients === "boolean"
      ? { enableProjectLevelRecipients: existingRule.enableProjectLevelRecipients }
      : {}),
  };
}

function getNotificationChanges(
  budget: BillingBudgetSummary,
  desiredRule: DesiredBudgetNotificationRule,
): string[] {
  const changes: string[] = [];
  if (budget.notificationsRule?.pubsubTopic !== desiredRule.pubsubTopic) {
    changes.push(`Set Pub/Sub topic to ${desiredRule.pubsubTopic}.`);
  }
  if (budget.notificationsRule?.schemaVersion !== desiredRule.schemaVersion) {
    changes.push("Set Pub/Sub notification schema version to 1.0.");
  }
  return changes;
}

function getAuditBlockers(audit: BillingGuardAudit): string[] {
  const blockers: string[] = [];
  if (!audit.billingEnabled) {
    blockers.push("Billing is disabled for the project.");
  }
  if (!audit.billingAccountId) {
    blockers.push("No linked billing account was visible.");
  }
  if (audit.risk === "review") {
    blockers.push("Billing budgets could not be inspected.");
  }
  return blockers;
}

function getTopicAuditBlockers(topicAudit: PubsubTopicAudit | undefined): string[] {
  if (!topicAudit) {
    return [];
  }
  switch (topicAudit.risk) {
    case "low":
      return [];
    case "missing_topic":
      return [`Pub/Sub topic does not exist or is not visible: ${topicAudit.name}.`];
    case "missing_publisher":
      return [`No Pub/Sub Publisher binding is visible on ${topicAudit.name}.`];
    case "review":
      return [`Pub/Sub topic or IAM policy could not be fully inspected: ${topicAudit.name}.`];
  }
}

function normalizeProjectId(value: string | undefined): string {
  const projectId = value?.trim() ?? "";
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new ValidationError("A valid project ID is required.");
  }
  return projectId;
}

function normalizePubsubTopic(projectId: string, value: string | undefined): string {
  const topic = value?.trim() ?? "";
  if (!topic) {
    throw new ValidationError("Pub/Sub topic is required.");
  }

  if (topic.includes("/")) {
    if (!/^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/.test(topic)) {
      throw new ValidationError("Pub/Sub topic must use projects/{projectId}/topics/{topicId}.");
    }
    return topic;
  }

  if (!/^[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/.test(topic)) {
    throw new ValidationError("Pub/Sub topic ID is invalid.");
  }
  return `projects/${projectId}/topics/${topic}`;
}

function normalizeDisplayName(value: string | undefined): string | undefined {
  const displayName = value?.trim();
  if (!displayName) {
    return undefined;
  }
  if (displayName.length > 60) {
    throw new ValidationError("Budget display name must be 60 characters or less.");
  }
  return displayName;
}
