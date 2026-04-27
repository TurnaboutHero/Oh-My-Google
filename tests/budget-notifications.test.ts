import { describe, expect, it } from "vitest";
import {
  auditBudgetNotificationPosture,
  parseBudgetNotificationPolicyInput,
  planBudgetNotificationApiMutation,
  planBudgetNotificationEnsure,
  verifyBudgetNotificationPostState,
} from "../src/connectors/budget-notifications.js";
import type { BillingGuardAudit } from "../src/connectors/billing-audit.js";

describe("budget notification planner", () => {
  it("normalizes a bare Pub/Sub topic ID to the project topic resource", () => {
    expect(parseBudgetNotificationPolicyInput({
      project: "demo-project",
      topic: "budget-alerts",
    })).toEqual({
      projectId: "demo-project",
      pubsubTopic: "projects/demo-project/topics/budget-alerts",
      targetBudgetDisplayName: "omg budget guard: demo-project",
    });
  });

  it("audits notification posture across visible budgets", () => {
    expect(auditBudgetNotificationPosture(baseAudit()).posture).toBe("none");

    expect(auditBudgetNotificationPosture({
      ...baseAudit(),
      budgets: [
        {
          name: "billingAccounts/ABC-123/budgets/budget-1",
          displayName: "Budget with topic",
          thresholdPercents: [0.5, 0.9],
          notificationsRule: {
            pubsubTopic: "projects/demo-project/topics/budget-alerts",
            schemaVersion: "1.0",
          },
        },
        {
          name: "billingAccounts/ABC-123/budgets/budget-2",
          displayName: "Budget without topic",
          thresholdPercents: [0.5, 0.9],
        },
      ],
    })).toMatchObject({
      posture: "partial",
      budgetCount: 2,
      configuredBudgetCount: 1,
    });
  });

  it("plans a notification update while preserving existing email notification settings", () => {
    const input = parseBudgetNotificationPolicyInput({
      project: "demo-project",
      topic: "projects/finops-admin/topics/budget-alerts",
    });
    const plan = planBudgetNotificationEnsure({
      ...baseAudit(),
      budgets: [
        {
          name: "billingAccounts/ABC-123/budgets/budget-1",
          displayName: "omg budget guard: demo-project",
          thresholdPercents: [0.5, 0.9],
          notificationsRule: {
            monitoringNotificationChannels: ["projects/demo-project/notificationChannels/channel-1"],
            disableDefaultIamRecipients: true,
            enableProjectLevelRecipients: true,
          },
        },
      ],
    }, input);

    expect(plan).toMatchObject({
      action: "update",
      changes: [
        "Set Pub/Sub topic to projects/finops-admin/topics/budget-alerts.",
        "Set Pub/Sub notification schema version to 1.0.",
      ],
      desiredRule: {
        pubsubTopic: "projects/finops-admin/topics/budget-alerts",
        schemaVersion: "1.0",
        monitoringNotificationChannels: ["projects/demo-project/notificationChannels/channel-1"],
        disableDefaultIamRecipients: true,
        enableProjectLevelRecipients: true,
      },
    });
  });

  it("builds an update mutation contract without executing the Budget API", () => {
    const input = parseBudgetNotificationPolicyInput({
      project: "demo-project",
      topic: "budget-alerts",
    });
    const plan = planBudgetNotificationEnsure({
      ...baseAudit(),
      budgets: [
        {
          name: "billingAccounts/ABC-123/budgets/budget-1",
          displayName: "omg budget guard: demo-project",
          thresholdPercents: [0.5, 0.9],
        },
      ],
    }, input);

    expect(planBudgetNotificationApiMutation(plan)).toEqual({
      action: "update",
      name: "billingAccounts/ABC-123/budgets/budget-1",
      updateMask: ["notificationsRule"],
      budget: {
        name: "billingAccounts/ABC-123/budgets/budget-1",
        notificationsRule: {
          pubsubTopic: "projects/demo-project/topics/budget-alerts",
          schemaVersion: "1.0",
        },
      },
      blockers: [],
    });
  });

  it("blocks ensure planning when the target budget is not visible", () => {
    const plan = planBudgetNotificationEnsure(baseAudit(), parseBudgetNotificationPolicyInput({
      project: "demo-project",
      topic: "budget-alerts",
    }));

    expect(plan).toMatchObject({
      action: "blocked",
      blockers: ["No visible budget named omg budget guard: demo-project."],
    });
  });

  it("blocks ensure planning when the Pub/Sub topic is not ready", () => {
    const plan = planBudgetNotificationEnsure({
      ...baseAudit(),
      budgets: [
        {
          name: "billingAccounts/ABC-123/budgets/budget-1",
          displayName: "omg budget guard: demo-project",
          thresholdPercents: [0.5, 0.9],
        },
      ],
    }, parseBudgetNotificationPolicyInput({
      project: "demo-project",
      topic: "budget-alerts",
    }), {
      projectId: "demo-project",
      topicId: "budget-alerts",
      name: "projects/demo-project/topics/budget-alerts",
      topicStatus: "visible",
      iamStatus: "visible",
      publisherBindingStatus: "missing",
      publisherMembers: [],
      bindings: [],
      inaccessible: [],
      signals: ["No Pub/Sub Publisher binding is visible on projects/demo-project/topics/budget-alerts."],
      risk: "missing_publisher",
      recommendedAction: "Review Pub/Sub Publisher permission before connecting budget notifications.",
    });

    expect(plan).toMatchObject({
      action: "blocked",
      blockers: ["No Pub/Sub Publisher binding is visible on projects/demo-project/topics/budget-alerts."],
    });
  });

  it("verifies post-state only when the expected Pub/Sub topic and schema are visible", () => {
    const input = parseBudgetNotificationPolicyInput({
      project: "demo-project",
      topic: "budget-alerts",
    });

    expect(verifyBudgetNotificationPostState(baseAudit(), input)).toMatchObject({
      verified: false,
      action: "blocked",
    });

    expect(verifyBudgetNotificationPostState({
      ...baseAudit(),
      budgets: [
        {
          name: "billingAccounts/ABC-123/budgets/budget-1",
          displayName: "omg budget guard: demo-project",
          thresholdPercents: [0.5, 0.9],
          notificationsRule: {
            pubsubTopic: "projects/demo-project/topics/budget-alerts",
            schemaVersion: "1.0",
          },
        },
      ],
    }, input)).toMatchObject({
      verified: true,
      action: "none",
      remainingChanges: [],
      blockers: [],
    });
  });
});

function baseAudit(): BillingGuardAudit {
  return {
    projectId: "demo-project",
    billingEnabled: true,
    billingAccountId: "ABC-123",
    budgets: [],
    signals: ["Billing is enabled but no budgets were found."],
    risk: "missing_budget",
    recommendedAction: "Create a billing budget before running cost-bearing live operations.",
  };
}
