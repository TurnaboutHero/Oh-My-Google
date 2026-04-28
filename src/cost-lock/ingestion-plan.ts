import type { BillingGuardAudit } from "../connectors/billing-audit.js";
import {
  planBudgetNotificationEnsure,
  type BudgetNotificationPolicyInput,
} from "../connectors/budget-notifications.js";
import {
  parsePubsubTopicResource,
  type PubsubTopicAudit,
} from "../connectors/pubsub-topic-audit.js";

export type CostLockIngestionStatus = "ready" | "review" | "blocked";

export interface CostLockIngestionManualStep {
  category: string;
  reason: string;
  command?: string;
}

export interface CostLockIngestionPlan {
  projectId: string;
  pubsubTopic: string;
  targetBudgetDisplayName: string;
  dryRun: true;
  liveMutation: false;
  status: CostLockIngestionStatus;
  notificationAction: "none" | "update" | "blocked";
  topicRisk?: PubsubTopicAudit["risk"];
  subscriptionId: string;
  subscriptionCommand: string;
  handlerResponsibilities: string[];
  costLockCommand: string;
  manualSteps: CostLockIngestionManualStep[];
  blockers: string[];
  warnings: string[];
  recommendedAction: string;
  next: string[];
}

const DEFAULT_SUBSCRIPTION_ID = "omg-cost-lock-alerts";

export function planCostLockIngestion(
  audit: BillingGuardAudit,
  input: BudgetNotificationPolicyInput,
  topicAudit?: PubsubTopicAudit,
): CostLockIngestionPlan {
  const notificationPlan = planBudgetNotificationEnsure(audit, input, topicAudit);
  const topic = parsePubsubTopicResource(input.pubsubTopic);
  const blockers = [...notificationPlan.blockers];
  const warnings: string[] = [];

  if (!topicAudit) {
    blockers.push("Pub/Sub topic audit is required before planning cost lock ingestion.");
  }

  if (notificationPlan.action === "update") {
    warnings.push(
      `Budget notification routing is not yet connected to ${input.pubsubTopic}.`,
      ...notificationPlan.changes,
    );
  }

  const status: CostLockIngestionStatus = blockers.length > 0
    ? "blocked"
    : notificationPlan.action === "none"
      ? "ready"
      : "review";
  const subscriptionId = DEFAULT_SUBSCRIPTION_ID;
  const subscriptionCommand = [
    "gcloud pubsub subscriptions create",
    subscriptionId,
    `--project ${topic.projectId}`,
    `--topic ${topic.topicId}`,
  ].join(" ");
  const costLockCommand = [
    "omg cost lock",
    `--project ${input.projectId}`,
    `--reason "budget Pub/Sub alert received from ${input.pubsubTopic}"`,
  ].join(" ");

  return {
    projectId: input.projectId,
    pubsubTopic: input.pubsubTopic,
    targetBudgetDisplayName: input.targetBudgetDisplayName,
    dryRun: true,
    liveMutation: false,
    status,
    notificationAction: notificationPlan.action,
    topicRisk: topicAudit?.risk,
    subscriptionId,
    subscriptionCommand,
    handlerResponsibilities: [
      "Pull or receive Cloud Billing Budget Pub/Sub schema version 1.0 messages.",
      "Validate the alert belongs to the expected project and budget before taking action.",
      "Write local .omg/cost-lock.json by invoking omg cost lock or the equivalent local core.",
      "Acknowledge Pub/Sub messages only after the local cost lock write succeeds.",
      "Never unlock automatically; clearing a lock remains an explicit operator action.",
    ],
    costLockCommand,
    manualSteps: [
      {
        category: "subscription",
        reason: "A subscription or equivalent reviewed delivery path is required before any automatic handler can receive budget alerts.",
        command: subscriptionCommand,
      },
      {
        category: "subscriber-permission",
        reason: "The handler identity needs Pub/Sub Subscriber permission only for the selected subscription.",
        command: `gcloud pubsub subscriptions add-iam-policy-binding ${subscriptionId} --project ${topic.projectId} --member <handler-principal> --role roles/pubsub.subscriber`,
      },
      {
        category: "handler",
        reason: "The handler must run in an environment that can write this workspace's local .omg cost-lock state.",
      },
      {
        category: "local-lock",
        reason: "The handler action should be equivalent to this local command.",
        command: costLockCommand,
      },
    ],
    blockers,
    warnings,
    recommendedAction: getRecommendedAction(status),
    next: getNext(status, input.projectId),
  };
}

function getRecommendedAction(status: CostLockIngestionStatus): string {
  switch (status) {
    case "ready":
      return "Review and implement a subscriber handler; automatic cost lock ingestion is not enabled by omg yet.";
    case "review":
      return "Connect budget notification routing first, then review the subscriber handler design.";
    case "blocked":
      return "Resolve budget notification or Pub/Sub topic blockers before planning automatic cost lock ingestion.";
  }
}

function getNext(status: CostLockIngestionStatus, projectId: string): string[] {
  if (status === "blocked" || status === "review") {
    return [`omg budget notifications ensure --project ${projectId} --topic <topic> --dry-run`];
  }
  return ["Review docs/runbooks/budget-cost-lock-ingestion.md before implementing a live subscriber."];
}
