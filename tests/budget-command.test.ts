import { describe, expect, it, vi } from "vitest";
import { auditBillingGuard } from "../src/connectors/billing-audit.js";
import {
  BudgetApiTransportError,
  type BudgetApiRequestExecutor,
} from "../src/connectors/budget-api.js";
import { auditPubsubTopic } from "../src/connectors/pubsub-topic-audit.js";
import {
  runBudgetAudit,
  runBudgetEnableApi,
  runBudgetEnsure,
  runBudgetNotificationsAudit,
  runBudgetNotificationsEnsure,
  runBudgetNotificationsLockIngestion,
} from "../src/cli/commands/budget.js";

const enableApisMock = vi.hoisted(() => vi.fn(async () => undefined));
const auditBillingGuardMock = vi.hoisted(() => vi.fn(async (projectId: string) => ({
  projectId,
  billingEnabled: true,
  billingAccountId: "ABC-123",
  budgets: [],
  signals: ["Billing is enabled but no budgets were found."],
  risk: "missing_budget",
  recommendedAction: "Create a billing budget before running cost-bearing live operations.",
})));
const auditPubsubTopicMock = vi.hoisted(() => vi.fn(async (topic: string) => ({
  projectId: "demo-project",
  topicId: "budget-alerts",
  name: topic,
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
  signals: [`Pub/Sub topic is visible: ${topic}.`],
  risk: "low",
  recommendedAction: "Pub/Sub topic exists and a Pub/Sub Publisher binding is visible.",
})));

vi.mock("../src/connectors/billing-audit.js", () => ({
  auditBillingGuard: auditBillingGuardMock,
}));

vi.mock("../src/connectors/pubsub-topic-audit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/connectors/pubsub-topic-audit.js")>();
  return {
    ...actual,
    auditPubsubTopic: auditPubsubTopicMock,
  };
});

vi.mock("../src/setup/apis.js", () => ({
  enableApis: enableApisMock,
}));

describe("budget command", () => {
  const mockedAuditBillingGuard = vi.mocked(auditBillingGuard);
  const mockedAuditPubsubTopic = vi.mocked(auditPubsubTopic);

  it("runs a read-only billing budget audit", async () => {
    const result = await runBudgetAudit({ project: "demo-project" });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.risk : undefined).toBe("missing_budget");
    expect(result.ok ? result.next : undefined).toContain("Create a billing budget for billing account ABC-123.");
  });

  it("requires a project id", async () => {
    const result = await runBudgetAudit({});

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns a dry-run plan for enabling the Budget API", async () => {
    const result = await runBudgetEnableApi({ project: "demo-project", dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.dryRun : undefined).toBe(true);
    expect(result.ok ? result.data.api : undefined).toBe("billingbudgets.googleapis.com");
    expect(enableApisMock).not.toHaveBeenCalled();
  });

  it("requires explicit yes before enabling the Budget API", async () => {
    const result = await runBudgetEnableApi({ project: "demo-project" });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("TRUST_REQUIRES_CONFIRM");
    expect(enableApisMock).not.toHaveBeenCalled();
  });

  it("enables the Budget API with explicit yes", async () => {
    const result = await runBudgetEnableApi({ project: "demo-project", yes: true });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.enabled : undefined).toBe(true);
    expect(enableApisMock).toHaveBeenCalledWith("demo-project", ["billingbudgets.googleapis.com"]);
  });

  it("returns a dry-run create plan for the expected budget policy", async () => {
    const result = await runBudgetEnsure({
      project: "demo-project",
      amount: "50000",
      currency: "KRW",
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.action : undefined).toBe("create");
    expect(result.ok ? result.data.desiredPolicy : undefined).toMatchObject({
      displayName: "omg budget guard: demo-project",
      amount: { currencyCode: "KRW", units: "50000" },
      thresholdPercents: [0.5, 0.9, 1],
    });
    expect(result.ok ? result.data.dryRun : undefined).toBe(true);
  });

  it("reports no change when the expected budget policy is visible", async () => {
    mockedAuditBillingGuard.mockResolvedValueOnce({
      projectId: "demo-project",
      billingEnabled: true,
      billingAccountId: "ABC-123",
      budgets: [
        {
          name: "billingAccounts/ABC-123/budgets/budget-1",
          displayName: "omg budget guard: demo-project",
          amount: { currencyCode: "KRW", units: "50000" },
          thresholdPercents: [0.5, 0.9, 1],
        },
      ],
      signals: ["Budget configured: omg budget guard: demo-project."],
      risk: "configured",
      recommendedAction: "Budget guard is configured for this billing account.",
    });

    const result = await runBudgetEnsure({
      project: "demo-project",
      amount: "50000",
      currency: "KRW",
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.action : undefined).toBe("none");
    expect(result.ok ? result.data.changes : undefined).toEqual([]);
  });

  it("returns an update plan when the named budget differs", async () => {
    mockedAuditBillingGuard.mockResolvedValueOnce({
      projectId: "demo-project",
      billingEnabled: true,
      billingAccountId: "ABC-123",
      budgets: [
        {
          name: "billingAccounts/ABC-123/budgets/budget-1",
          displayName: "omg budget guard: demo-project",
          amount: { currencyCode: "KRW", units: "30000" },
          thresholdPercents: [0.5],
        },
      ],
      signals: ["Budget configured: omg budget guard: demo-project."],
      risk: "configured",
      recommendedAction: "Budget guard is configured for this billing account.",
    });

    const result = await runBudgetEnsure({
      project: "demo-project",
      amount: "50000",
      currency: "KRW",
      thresholds: "0.5,0.9,1",
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.action : undefined).toBe("update");
    expect(result.ok ? result.data.changes : undefined).toEqual([
      "Set amount to KRW 50000.",
      "Set thresholds to 50%, 90%, 100%.",
    ]);
  });

  it("requires dry-run for budget ensure in the safe implementation", async () => {
    const auditCallCount = mockedAuditBillingGuard.mock.calls.length;
    const result = await runBudgetEnsure({
      project: "demo-project",
      amount: "50000",
      currency: "KRW",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("TRUST_REQUIRES_CONFIRM");
    expect(mockedAuditBillingGuard.mock.calls.length).toBe(auditCallCount);
  });

  it("keeps production budget ensure live mutation blocked without an injected executor", async () => {
    const auditCallCount = mockedAuditBillingGuard.mock.calls.length;
    const result = await runBudgetEnsure({
      project: "demo-project",
      amount: "50000",
      currency: "KRW",
      yes: true,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("BUDGET_ENSURE_LIVE_NOT_IMPLEMENTED");
    expect(mockedAuditBillingGuard.mock.calls.length).toBe(auditCallCount);
  });

  it("executes budget ensure create through an injected executor and post-verifies with injected audit", async () => {
    const liveExecutor = vi.fn<BudgetApiRequestExecutor>(async (request) => ({
      name: "billingAccounts/ABC-123/budgets/budget-2",
      ...request.body,
    }));
    const auditAfterMutation = vi.fn(async () => configuredBudgetAudit());

    const result = await runBudgetEnsure({
      project: "demo-project",
      amount: "50000",
      currency: "KRW",
      yes: true,
      liveExecutor,
      auditAfterMutation,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.dryRun : undefined).toBe(false);
    expect(result.ok ? result.data.liveMutation : undefined).toBe(true);
    expect(result.ok ? result.data.mutation : undefined).toMatchObject({ action: "create" });
    expect(result.ok ? result.data.mutationResult : undefined).toMatchObject({
      action: "create",
      executed: true,
      request: { method: "POST" },
    });
    expect(liveExecutor).toHaveBeenCalledTimes(1);
    expect(auditAfterMutation).toHaveBeenCalledWith("demo-project");
  });

  it("maps budget ensure post-verification failure without claiming live success", async () => {
    const liveExecutor = vi.fn<BudgetApiRequestExecutor>(async (request) => ({
      name: "billingAccounts/ABC-123/budgets/budget-2",
      ...request.body,
    }));
    const auditAfterMutation = vi.fn(async () => ({
      projectId: "demo-project",
      billingEnabled: true,
      billingAccountId: "ABC-123",
      budgets: [],
      signals: ["Billing is enabled but no budgets were found."],
      risk: "missing_budget" as const,
      recommendedAction: "Create a billing budget before running cost-bearing live operations.",
    }));

    const result = await runBudgetEnsure({
      project: "demo-project",
      amount: "50000",
      currency: "KRW",
      yes: true,
      liveExecutor,
      auditAfterMutation,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("BUDGET_ENSURE_POST_VERIFY_FAILED");
    expect(result.ok ? undefined : result.error.data?.liveMutationAttempted).toBe(true);
    expect(result.ok ? undefined : result.error.next).toContain("omg budget audit --project demo-project");
  });

  it("maps injected Budget API transport failures without using the real transport", async () => {
    const liveExecutor = vi.fn<BudgetApiRequestExecutor>(async () => {
      throw new BudgetApiTransportError({
        code: "BUDGET_API_PERMISSION_DENIED",
        message: "Budget API permission denied.",
        recoverable: true,
        retryable: false,
        statusCode: 403,
        reason: "missing billing.budgets.update",
        next: ["Review Cloud Billing Budget IAM permissions."],
      });
    });

    const result = await runBudgetEnsure({
      project: "demo-project",
      amount: "50000",
      currency: "KRW",
      yes: true,
      liveExecutor,
      auditAfterMutation: vi.fn(async () => configuredBudgetAudit()),
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("BUDGET_API_PERMISSION_DENIED");
    expect(result.ok ? undefined : result.error.data?.retryable).toBe(false);
    expect(result.ok ? undefined : result.error.data?.statusCode).toBe(403);
    expect(liveExecutor).toHaveBeenCalledTimes(1);
  });

  it("runs a read-only budget notification posture audit with optional topic audit", async () => {
    mockedAuditBillingGuard.mockResolvedValueOnce({
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
    });

    const result = await runBudgetNotificationsAudit({
      project: "demo-project",
      topic: "budget-alerts",
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.posture : undefined).toBe("configured");
    expect(result.ok ? result.next : undefined).toEqual([]);
    expect(mockedAuditPubsubTopic).toHaveBeenCalledWith("projects/demo-project/topics/budget-alerts");
    expect(result.ok ? result.data.topicAudit : undefined).toMatchObject({
      topicStatus: "visible",
      publisherBindingStatus: "present",
      risk: "low",
    });
  });

  it("returns a dry-run update plan for budget notification routing", async () => {
    mockedAuditBillingGuard.mockResolvedValueOnce({
      projectId: "demo-project",
      billingEnabled: true,
      billingAccountId: "ABC-123",
      budgets: [
        {
          name: "billingAccounts/ABC-123/budgets/budget-1",
          displayName: "omg budget guard: demo-project",
          thresholdPercents: [0.5, 0.9, 1],
        },
      ],
      signals: ["Budget configured: omg budget guard: demo-project."],
      risk: "configured",
      recommendedAction: "Budget guard is configured for this billing account.",
    });

    const result = await runBudgetNotificationsEnsure({
      project: "demo-project",
      topic: "budget-alerts",
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.action : undefined).toBe("update");
    expect(result.ok ? result.data.desiredRule : undefined).toMatchObject({
      pubsubTopic: "projects/demo-project/topics/budget-alerts",
      schemaVersion: "1.0",
    });
    expect(result.ok ? result.data.topicAudit : undefined).toMatchObject({
      risk: "low",
      publisherBindingStatus: "present",
    });
  });

  it("blocks budget notification ensure dry-run when the target Pub/Sub topic is missing", async () => {
    mockedAuditBillingGuard.mockResolvedValueOnce({
      projectId: "demo-project",
      billingEnabled: true,
      billingAccountId: "ABC-123",
      budgets: [
        {
          name: "billingAccounts/ABC-123/budgets/budget-1",
          displayName: "omg budget guard: demo-project",
          thresholdPercents: [0.5, 0.9, 1],
        },
      ],
      signals: ["Budget configured: omg budget guard: demo-project."],
      risk: "configured",
      recommendedAction: "Budget guard is configured for this billing account.",
    });
    mockedAuditPubsubTopic.mockResolvedValueOnce({
      projectId: "demo-project",
      topicId: "budget-alerts",
      name: "projects/demo-project/topics/budget-alerts",
      topicStatus: "missing",
      iamStatus: "not_checked",
      publisherBindingStatus: "not_checked",
      publisherMembers: [],
      bindings: [],
      inaccessible: [],
      signals: ["Pub/Sub topic does not exist or is not visible: projects/demo-project/topics/budget-alerts."],
      risk: "missing_topic",
      recommendedAction: "Create the Pub/Sub topic before connecting budget notifications.",
    });

    const result = await runBudgetNotificationsEnsure({
      project: "demo-project",
      topic: "budget-alerts",
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.action : undefined).toBe("blocked");
    expect(result.ok ? result.data.blockers : undefined).toContain(
      "Pub/Sub topic does not exist or is not visible: projects/demo-project/topics/budget-alerts.",
    );
  });

  it("requires dry-run for budget notification ensure in the safe implementation", async () => {
    const result = await runBudgetNotificationsEnsure({
      project: "demo-project",
      topic: "budget-alerts",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("TRUST_REQUIRES_CONFIRM");
  });

  it("does not perform live budget notification mutation even with yes in this safe pass", async () => {
    const result = await runBudgetNotificationsEnsure({
      project: "demo-project",
      topic: "budget-alerts",
      yes: true,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("BUDGET_NOTIFICATIONS_LIVE_NOT_IMPLEMENTED");
  });

  it("returns a dry-run plan for budget alert cost-lock ingestion", async () => {
    mockedAuditBillingGuard.mockResolvedValueOnce({
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
    });

    const result = await runBudgetNotificationsLockIngestion({
      project: "demo-project",
      topic: "budget-alerts",
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.status : undefined).toBe("ready");
    expect(result.ok ? result.data.liveMutation : undefined).toBe(false);
    expect(result.ok ? result.data.subscriptionCommand : undefined).toBe(
      "gcloud pubsub subscriptions create omg-cost-lock-alerts --project demo-project --topic budget-alerts",
    );
    expect(mockedAuditPubsubTopic).toHaveBeenCalledWith("projects/demo-project/topics/budget-alerts");
  });

  it("keeps budget alert cost-lock ingestion setup dry-run only", async () => {
    const withoutDryRun = await runBudgetNotificationsLockIngestion({
      project: "demo-project",
      topic: "budget-alerts",
    });

    expect(withoutDryRun.ok).toBe(false);
    expect(withoutDryRun.ok ? undefined : withoutDryRun.error.code).toBe("TRUST_REQUIRES_CONFIRM");

    const live = await runBudgetNotificationsLockIngestion({
      project: "demo-project",
      topic: "budget-alerts",
      yes: true,
    });

    expect(live.ok).toBe(false);
    expect(live.ok ? undefined : live.error.code).toBe("BUDGET_LOCK_INGESTION_LIVE_NOT_IMPLEMENTED");
  });
});

function configuredBudgetAudit() {
  return {
    projectId: "demo-project",
    billingEnabled: true,
    billingAccountId: "ABC-123",
    budgets: [
      {
        name: "billingAccounts/ABC-123/budgets/budget-2",
        displayName: "omg budget guard: demo-project",
        amount: { currencyCode: "KRW", units: "50000" },
        thresholdPercents: [0.5, 0.9, 1],
      },
    ],
    signals: ["Budget configured: omg budget guard: demo-project."],
    risk: "configured" as const,
    recommendedAction: "Budget guard is configured for this billing account.",
  };
}
