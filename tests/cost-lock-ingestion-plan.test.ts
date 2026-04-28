import { describe, expect, it } from "vitest";
import type { BillingGuardAudit } from "../src/connectors/billing-audit.js";
import { parseBudgetNotificationPolicyInput } from "../src/connectors/budget-notifications.js";
import type { PubsubTopicAudit } from "../src/connectors/pubsub-topic-audit.js";
import { planCostLockIngestion } from "../src/cost-lock/ingestion-plan.js";

describe("Budget Pub/Sub to cost-lock ingestion plan", () => {
  it("plans a reviewed subscriber path when budget notification routing is visible", () => {
    const input = parseBudgetNotificationPolicyInput({
      project: "demo-project",
      topic: "budget-alerts",
    });
    const plan = planCostLockIngestion(configuredAudit(), input, readyTopicAudit());

    expect(plan).toMatchObject({
      projectId: "demo-project",
      pubsubTopic: "projects/demo-project/topics/budget-alerts",
      dryRun: true,
      liveMutation: false,
      status: "ready",
      notificationAction: "none",
      topicRisk: "low",
      subscriptionId: "omg-cost-lock-alerts",
      costLockCommand: "omg cost lock --project demo-project --reason \"budget Pub/Sub alert received from projects/demo-project/topics/budget-alerts\"",
      blockers: [],
      warnings: [],
    });
    expect(plan.subscriptionCommand).toBe(
      "gcloud pubsub subscriptions create omg-cost-lock-alerts --project demo-project --topic budget-alerts",
    );
    expect(plan.handlerResponsibilities).toContain(
      "Acknowledge Pub/Sub messages only after the local cost lock write succeeds.",
    );
  });

  it("returns review when notification routing still needs an update", () => {
    const input = parseBudgetNotificationPolicyInput({
      project: "demo-project",
      topic: "budget-alerts",
    });
    const plan = planCostLockIngestion({
      ...configuredAudit(),
      budgets: [
        {
          name: "billingAccounts/ABC-123/budgets/budget-1",
          displayName: "omg budget guard: demo-project",
          thresholdPercents: [0.5, 0.9, 1],
        },
      ],
    }, input, readyTopicAudit());

    expect(plan.status).toBe("review");
    expect(plan.notificationAction).toBe("update");
    expect(plan.warnings).toContain(
      "Budget notification routing is not yet connected to projects/demo-project/topics/budget-alerts.",
    );
    expect(plan.next).toEqual([
      "omg budget notifications ensure --project demo-project --topic <topic> --dry-run",
    ]);
  });

  it("blocks when the Pub/Sub topic is not ready", () => {
    const input = parseBudgetNotificationPolicyInput({
      project: "demo-project",
      topic: "budget-alerts",
    });
    const plan = planCostLockIngestion(configuredAudit(), input, {
      ...readyTopicAudit(),
      publisherBindingStatus: "missing",
      publisherMembers: [],
      bindings: [],
      signals: ["No Pub/Sub Publisher binding is visible on projects/demo-project/topics/budget-alerts."],
      risk: "missing_publisher",
      recommendedAction: "Review Pub/Sub Publisher permission before connecting budget notifications.",
    });

    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toContain(
      "No Pub/Sub Publisher binding is visible on projects/demo-project/topics/budget-alerts.",
    );
  });
});

function configuredAudit(): BillingGuardAudit {
  return {
    projectId: "demo-project",
    billingEnabled: true,
    billingAccountId: "ABC-123",
    budgets: [
      {
        name: "billingAccounts/ABC-123/budgets/budget-1",
        displayName: "omg budget guard: demo-project",
        thresholdPercents: [0.5, 0.9, 1],
        notificationsRule: {
          pubsubTopic: "projects/demo-project/topics/budget-alerts",
          schemaVersion: "1.0",
        },
      },
    ],
    signals: ["Budget configured: omg budget guard: demo-project."],
    risk: "configured",
    recommendedAction: "Budget guard is configured for this billing account.",
  };
}

function readyTopicAudit(): PubsubTopicAudit {
  return {
    projectId: "demo-project",
    topicId: "budget-alerts",
    name: "projects/demo-project/topics/budget-alerts",
    topicStatus: "visible",
    iamStatus: "visible",
    publisherBindingStatus: "present",
    publisherMembers: ["serviceAccount:billing-budget-alert@system.gserviceaccount.com"],
    bindings: [
      {
        role: "roles/pubsub.publisher",
        members: ["serviceAccount:billing-budget-alert@system.gserviceaccount.com"],
        memberCount: 1,
      },
    ],
    inaccessible: [],
    signals: [
      "Pub/Sub topic is visible: projects/demo-project/topics/budget-alerts.",
      "Pub/Sub Publisher binding is visible on projects/demo-project/topics/budget-alerts.",
    ],
    risk: "low",
    recommendedAction: "Pub/Sub topic exists and a Pub/Sub Publisher binding is visible.",
  };
}
