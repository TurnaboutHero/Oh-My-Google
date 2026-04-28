import { describe, expect, it, vi } from "vitest";
import { executeBudgetEnsureWithPostVerification, type BudgetApiRequestExecutor } from "../src/connectors/budget-api.js";
import {
  buildBudgetEnsureDryRunCommand,
  describeBudgetEnsureLiveGate,
  toBudgetEnsureLiveGateError,
} from "../src/connectors/budget-live-gate.js";
import { planBudgetEnsure } from "../src/connectors/budget-policy.js";
import type { BillingGuardAudit } from "../src/connectors/billing-audit.js";

describe("budget ensure live gate contract", () => {
  it("describes transport, approval, decision-log, and post-verification requirements while live CLI stays blocked", () => {
    const contract = describeBudgetEnsureLiveGate({
      projectId: "demo-project",
      amount: "50000",
      currencyCode: "KRW",
      thresholds: [0.5, 0.9, 1],
    });

    expect(contract).toMatchObject({
      command: "budget:ensure",
      operationIntent: "budget.ensure",
      trustLevel: "L2",
      liveCliStatus: "blocked",
      currentLiveErrorCode: "BUDGET_ENSURE_LIVE_NOT_IMPLEMENTED",
      transport: {
        baseUrl: "https://billingbudgets.googleapis.com/v1",
        tokenCommand: ["gcloud", "auth", "print-access-token"],
        quotaProjectHeader: "x-goog-user-project",
        tokenLogging: "forbidden",
        retryableFailureCodes: ["BUDGET_API_RATE_LIMITED", "BUDGET_API_UNAVAILABLE"],
      },
      approval: {
        required: true,
        consumeBeforeMutation: true,
        reuseAllowed: false,
      },
      decisionLog: {
        required: true,
        phases: ["live-gate", "api-mutation", "post-verify"],
      },
      postVerification: {
        auditCommand: "omg budget audit --project demo-project",
        failureCode: "BUDGET_ENSURE_POST_VERIFY_FAILED",
      },
    });
    expect(contract.transport.requiredHeaders).toEqual(["authorization", "content-type", "x-goog-user-project"]);
    expect(contract.transport.nonRetryableFailureCodes).toContain("BUDGET_API_PERMISSION_DENIED");
    expect(contract.transport.nonRetryableFailureCodes).toContain("BUDGET_API_CONFLICT");
  });

  it("formats the recovery dry-run command without dropping optional fields", () => {
    expect(buildBudgetEnsureDryRunCommand({
      projectId: "demo-project",
      amount: "75000",
      currencyCode: "KRW",
      thresholds: [0.5, 0.75, 1],
      displayName: "omg budget guard: demo project",
    })).toBe(
      'omg budget ensure --project demo-project --amount 75000 --currency KRW --thresholds 0.5,0.75,1 --display-name "omg budget guard: demo project" --dry-run',
    );
  });

  it("maps post-verification failure to the CLI/MCP error envelope contract", async () => {
    const executor = vi.fn<BudgetApiRequestExecutor>(async (request) => ({
      name: "billingAccounts/ABC-123/budgets/budget-2",
      ...request.body,
    }));
    const result = await executeBudgetEnsureWithPostVerification({
      plan: createPlan(),
      executor,
      auditAfterMutation: async () => baseAudit(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const error = toBudgetEnsureLiveGateError({
      failure: result,
      command: {
        projectId: "demo-project",
        amount: "50000",
        currencyCode: "KRW",
      },
    });

    expect(error).toMatchObject({
      code: "BUDGET_ENSURE_POST_VERIFY_FAILED",
      recoverable: true,
      data: {
        projectId: "demo-project",
        liveMutationAttempted: true,
        mutationAction: "create",
      },
      next: [
        "omg budget audit --project demo-project",
        "omg budget ensure --project demo-project --amount 50000 --currency KRW --dry-run",
      ],
    });
    expect(error.message).toContain("post-verification");
    expect(error.data.postVerification?.verified).toBe(false);
  });

  it("maps blocked mutation plans without marking live mutation attempted", async () => {
    const result = await executeBudgetEnsureWithPostVerification({
      plan: blockedPlan(),
      executor: vi.fn<BudgetApiRequestExecutor>(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    const error = toBudgetEnsureLiveGateError({
      failure: result,
      command: {
        projectId: "demo-project",
        amount: "50000",
        currencyCode: "KRW",
      },
    });

    expect(error).toMatchObject({
      code: "BUDGET_ENSURE_MUTATION_BLOCKED",
      recoverable: true,
      data: {
        liveMutationAttempted: false,
        mutationAction: "blocked",
      },
      next: ["omg budget ensure --project demo-project --amount 50000 --currency KRW --dry-run"],
    });
  });
});

function createPlan() {
  return planBudgetEnsure(baseAudit(), {
    projectId: "demo-project",
    amount: 50000,
    currencyCode: "KRW",
    thresholdPercents: [0.5, 0.9, 1],
  });
}

function blockedPlan() {
  return planBudgetEnsure({
    ...baseAudit(),
    risk: "review",
    inaccessible: ["billing budgets"],
    budgets: [],
  }, {
    projectId: "demo-project",
    amount: 50000,
    currencyCode: "KRW",
    thresholdPercents: [0.5, 0.9, 1],
  });
}

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
