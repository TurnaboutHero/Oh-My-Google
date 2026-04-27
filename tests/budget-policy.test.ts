import { describe, expect, it } from "vitest";
import {
  parseBudgetPolicyInput,
  planBudgetApiMutation,
  planBudgetEnsure,
  verifyBudgetEnsurePostState,
} from "../src/connectors/budget-policy.js";
import type { BillingGuardAudit } from "../src/connectors/billing-audit.js";

describe("budget policy planner", () => {
  it("normalizes budget policy input", () => {
    expect(parseBudgetPolicyInput({
      project: "demo-project",
      amount: "100.5",
      currency: "krw",
      thresholds: "1,0.5,0.9,0.5",
    })).toEqual({
      projectId: "demo-project",
      amount: 100.5,
      currencyCode: "KRW",
      thresholdPercents: [0.5, 0.9, 1],
      displayName: undefined,
    });
  });

  it("blocks planning when billing budget visibility is incomplete", () => {
    const plan = planBudgetEnsure({
      ...baseAudit(),
      risk: "review",
      inaccessible: ["billing budgets"],
      budgets: [],
      signals: ["Billing budgets could not be inspected."],
      recommendedAction: "Review billing budget visibility before running cost-bearing live operations.",
    }, parseBudgetPolicyInput({
      project: "demo-project",
      amount: "50000",
      currency: "KRW",
    }));

    expect(plan.action).toBe("blocked");
    expect(plan.blockers).toContain("Billing budgets could not be inspected.");
  });

  it("creates a plan when no named budget exists", () => {
    const plan = planBudgetEnsure(baseAudit(), parseBudgetPolicyInput({
      project: "demo-project",
      amount: "50000",
      currency: "KRW",
    }));

    expect(plan.action).toBe("create");
    expect(plan.changes).toContain("Create budget omg budget guard: demo-project.");
  });

  it("builds a create mutation contract without executing the Budget API", () => {
    const plan = planBudgetEnsure(baseAudit(), parseBudgetPolicyInput({
      project: "demo-project",
      amount: "50000",
      currency: "KRW",
    }));

    expect(planBudgetApiMutation(plan)).toEqual({
      action: "create",
      parent: "billingAccounts/ABC-123",
      budget: {
        displayName: "omg budget guard: demo-project",
        budgetFilter: {
          projects: ["projects/demo-project"],
          calendarPeriod: "MONTH",
          creditTypesTreatment: "INCLUDE_ALL_CREDITS",
        },
        amount: {
          specifiedAmount: {
            currencyCode: "KRW",
            units: "50000",
          },
        },
        thresholdRules: [
          { thresholdPercent: 0.5, spendBasis: "CURRENT_SPEND" },
          { thresholdPercent: 0.9, spendBasis: "CURRENT_SPEND" },
          { thresholdPercent: 1, spendBasis: "CURRENT_SPEND" },
        ],
      },
      blockers: [],
    });
  });

  it("builds an update mutation contract with a conservative update mask", () => {
    const plan = planBudgetEnsure({
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
    }, parseBudgetPolicyInput({
      project: "demo-project",
      amount: "50000",
      currency: "KRW",
    }));

    expect(planBudgetApiMutation(plan)).toMatchObject({
      action: "update",
      name: "billingAccounts/ABC-123/budgets/budget-1",
      updateMask: ["displayName", "budgetFilter", "amount", "thresholdRules"],
      budget: {
        name: "billingAccounts/ABC-123/budgets/budget-1",
        displayName: "omg budget guard: demo-project",
      },
      blockers: [],
    });
  });

  it("verifies post-state only when the expected policy is visible", () => {
    const desiredPolicy = planBudgetEnsure(baseAudit(), parseBudgetPolicyInput({
      project: "demo-project",
      amount: "50000",
      currency: "KRW",
    })).desiredPolicy;

    expect(verifyBudgetEnsurePostState(baseAudit(), desiredPolicy)).toMatchObject({
      verified: false,
      action: "create",
      blockers: [],
    });

    expect(verifyBudgetEnsurePostState({
      ...baseAudit(),
      risk: "configured",
      budgets: [
        {
          name: "billingAccounts/ABC-123/budgets/budget-1",
          displayName: "omg budget guard: demo-project",
          amount: { currencyCode: "KRW", units: "50000" },
          thresholdPercents: [0.5, 0.9, 1],
        },
      ],
    }, desiredPolicy)).toMatchObject({
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
