import { describe, expect, it } from "vitest";
import {
  auditBillingAccountGuard,
  auditBillingGuard,
  type BillingAuditExecutor,
} from "../src/connectors/billing-audit.js";

describe("billing guard audit connector", () => {
  it("reports linked billing account and configured budgets", async () => {
    const calls: string[][] = [];
    const audit = await auditBillingGuard("demo-project", async (args) => {
      calls.push(args);
      if (args[0] === "billing" && args[1] === "projects" && args[2] === "describe") {
        return {
          stdout: JSON.stringify({
            billingAccountName: "billingAccounts/ABC-123",
            billingEnabled: true,
            projectId: "demo-project",
          }),
          stderr: "",
        };
      }
      if (args[0] === "billing" && args[1] === "budgets" && args[2] === "list") {
        return {
          stdout: JSON.stringify([
            {
              name: "billingAccounts/ABC-123/budgets/budget-1",
              displayName: "Monthly cap",
              amount: {
                specifiedAmount: {
                  currencyCode: "USD",
                  units: "50",
                },
              },
              thresholdRules: [{ thresholdPercent: 0.5 }, { thresholdPercent: 0.9 }],
            },
          ]),
          stderr: "",
        };
      }
      return { stdout: "{}", stderr: "" };
    });

    expect(calls).toContainEqual(["billing", "projects", "describe", "demo-project", "--format=json"]);
    expect(calls).toContainEqual(["billing", "budgets", "list", "--billing-account=ABC-123", "--format=json", "--quiet"]);
    expect(audit).toEqual({
      projectId: "demo-project",
      billingEnabled: true,
      billingAccountId: "ABC-123",
      budgets: [
        {
          name: "billingAccounts/ABC-123/budgets/budget-1",
          displayName: "Monthly cap",
          amount: {
            currencyCode: "USD",
            units: "50",
          },
          thresholdPercents: [0.5, 0.9],
        },
      ],
      signals: ["Budget configured: Monthly cap."],
      risk: "configured",
      recommendedAction: "Budget guard is configured for this billing account.",
    });
  });

  it("flags billing-enabled projects with no budgets", async () => {
    const audit = await auditBillingGuard("demo-project", fixtures({
      billing: {
        billingAccountName: "billingAccounts/ABC-123",
        billingEnabled: true,
      },
      budgets: [],
    }));

    expect(audit.risk).toBe("missing_budget");
    expect(audit.signals).toContain("Billing is enabled but no budgets were found.");
    expect(audit.recommendedAction).toBe("Create a billing budget before running cost-bearing live operations.");
  });

  it("does not list budgets when billing is disabled", async () => {
    const calls: string[][] = [];
    const audit = await auditBillingGuard("demo-project", async (args) => {
      calls.push(args);
      return {
        stdout: JSON.stringify({ billingEnabled: false }),
        stderr: "",
      };
    });

    expect(calls).toEqual([["billing", "projects", "describe", "demo-project", "--format=json"]]);
    expect(audit.risk).toBe("billing_disabled");
    expect(audit.budgets).toEqual([]);
  });

  it("audits a selected billing account before it is linked to the project", async () => {
    const calls: string[][] = [];
    const audit = await auditBillingAccountGuard("demo-project", "ABC-123", async (args) => {
      calls.push(args);
      return {
        stdout: JSON.stringify([
          {
            name: "billingAccounts/ABC-123/budgets/budget-1",
            displayName: "Monthly cap",
            thresholdRules: [{ thresholdPercent: 0.5 }],
          },
        ]),
        stderr: "",
      };
    });

    expect(calls).toEqual([
      ["billing", "budgets", "list", "--billing-account=ABC-123", "--format=json", "--quiet"],
    ]);
    expect(audit).toMatchObject({
      projectId: "demo-project",
      billingEnabled: true,
      billingAccountId: "ABC-123",
      risk: "configured",
    });
    expect(audit.budgets).toHaveLength(1);
  });
});

function fixtures(input: {
  billing: Record<string, unknown>;
  budgets: Array<Record<string, unknown>>;
}): BillingAuditExecutor {
  return async (args) => {
    if (args[0] === "billing" && args[1] === "projects" && args[2] === "describe") {
      return { stdout: JSON.stringify(input.billing), stderr: "" };
    }
    if (args[0] === "billing" && args[1] === "budgets" && args[2] === "list") {
      return { stdout: JSON.stringify(input.budgets), stderr: "" };
    }
    return { stdout: "{}", stderr: "" };
  };
}
