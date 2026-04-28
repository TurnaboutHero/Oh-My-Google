import { describe, expect, it, vi } from "vitest";
import {
  buildCreateBudgetRequest,
  buildUpdateBudgetRequest,
  executeBudgetApiMutation,
  executeBudgetEnsureWithPostVerification,
  type BudgetApiRequestExecutor,
} from "../src/connectors/budget-api.js";
import { planBudgetApiMutation, planBudgetEnsure } from "../src/connectors/budget-policy.js";
import type { BillingGuardAudit } from "../src/connectors/billing-audit.js";

describe("budget API executor core", () => {
  it("builds a create request without executing the transport", () => {
    const plan = planBudgetApiMutation(createPlan());

    expect(plan.action).toBe("create");
    const request = buildCreateBudgetRequest({
      apiUserProjectId: "demo-project",
      parent: plan.parent ?? "",
      budget: plan.budget!,
    });

    expect(request).toMatchObject({
      method: "POST",
      url: "https://billingbudgets.googleapis.com/v1/billingAccounts/ABC-123/budgets",
      path: "/v1/billingAccounts/ABC-123/budgets",
      headers: {
        "content-type": "application/json",
        "x-goog-user-project": "demo-project",
      },
      body: {
        displayName: "omg budget guard: demo-project",
      },
    });
  });

  it("builds an update request with a conservative update mask", () => {
    const plan = planBudgetApiMutation(updatePlan());

    expect(plan.action).toBe("update");
    const request = buildUpdateBudgetRequest({
      apiUserProjectId: "demo-project",
      name: plan.name ?? "",
      updateMask: plan.updateMask ?? [],
      budget: plan.budget!,
    });

    expect(request.method).toBe("PATCH");
    expect(request.url).toContain(
      "https://billingbudgets.googleapis.com/v1/billingAccounts/ABC-123/budgets/budget-1?",
    );
    expect(request.url).toContain("updateMask=displayName%2CbudgetFilter%2Camount%2CthresholdRules");
    expect(request.body.name).toBe("billingAccounts/ABC-123/budgets/budget-1");
  });

  it("executes create and update through an injected transport only", async () => {
    const executor = vi.fn<BudgetApiRequestExecutor>(async (request) => ({
      name: request.method === "POST"
        ? "billingAccounts/ABC-123/budgets/budget-2"
        : request.body.name,
      ...request.body,
    }));

    const createResult = await executeBudgetApiMutation({
      mutation: planBudgetApiMutation(createPlan()),
      apiUserProjectId: "demo-project",
      executor,
    });
    const updateResult = await executeBudgetApiMutation({
      mutation: planBudgetApiMutation(updatePlan()),
      apiUserProjectId: "demo-project",
      executor,
    });

    expect(createResult).toMatchObject({ action: "create", executed: true });
    expect(updateResult).toMatchObject({ action: "update", executed: true });
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("does not execute transport for none or blocked mutation plans", async () => {
    const executor = vi.fn<BudgetApiRequestExecutor>();
    const noneResult = await executeBudgetApiMutation({
      mutation: planBudgetApiMutation(noopPlan()),
      apiUserProjectId: "demo-project",
      executor,
    });
    const blockedResult = await executeBudgetApiMutation({
      mutation: planBudgetApiMutation(blockedPlan()),
      apiUserProjectId: "demo-project",
      executor,
    });

    expect(noneResult).toEqual({ action: "none", executed: false, blockers: [] });
    expect(blockedResult).toMatchObject({ action: "blocked", executed: false });
    expect(executor).not.toHaveBeenCalled();
  });

  it("post-verifies a successful create through a supplied audit provider", async () => {
    const executor = vi.fn<BudgetApiRequestExecutor>(async (request) => ({
      name: "billingAccounts/ABC-123/budgets/budget-2",
      ...request.body,
    }));
    const auditAfterMutation = vi.fn(async () => configuredAudit());

    const result = await executeBudgetEnsureWithPostVerification({
      plan: createPlan(),
      executor,
      auditAfterMutation,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.mutationResult.executed : undefined).toBe(true);
    expect(result.ok ? result.postVerification.verified : undefined).toBe(true);
    expect(auditAfterMutation).toHaveBeenCalledWith("demo-project");
  });

  it("returns a structured post-verification failure without claiming success", async () => {
    const executor = vi.fn<BudgetApiRequestExecutor>(async (request) => ({
      name: "billingAccounts/ABC-123/budgets/budget-2",
      ...request.body,
    }));
    const auditAfterMutation = vi.fn(async () => baseAudit());

    const result = await executeBudgetEnsureWithPostVerification({
      plan: createPlan(),
      executor,
      auditAfterMutation,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.errorCode).toBe("BUDGET_ENSURE_POST_VERIFY_FAILED");
    expect(result.ok ? undefined : result.postVerification?.verified).toBe(false);
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

function updatePlan() {
  return planBudgetEnsure({
    ...baseAudit(),
    risk: "configured",
    budgets: [
      {
        name: "billingAccounts/ABC-123/budgets/budget-1",
        displayName: "omg budget guard: demo-project",
        amount: { currencyCode: "KRW", units: "30000" },
        thresholdPercents: [0.5],
      },
    ],
  }, {
    projectId: "demo-project",
    amount: 50000,
    currencyCode: "KRW",
    thresholdPercents: [0.5, 0.9, 1],
  });
}

function noopPlan() {
  return planBudgetEnsure(configuredAudit(), {
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

function configuredAudit(): BillingGuardAudit {
  return {
    ...baseAudit(),
    risk: "configured",
    budgets: [
      {
        name: "billingAccounts/ABC-123/budgets/budget-2",
        displayName: "omg budget guard: demo-project",
        amount: { currencyCode: "KRW", units: "50000" },
        thresholdPercents: [0.5, 0.9, 1],
      },
    ],
    signals: ["Budget configured: omg budget guard: demo-project."],
    recommendedAction: "Budget guard is configured for this billing account.",
  };
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
