import { describe, expect, it, vi } from "vitest";
import { runBudgetAudit, runBudgetEnableApi } from "../src/cli/commands/budget.js";

const enableApisMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../src/connectors/billing-audit.js", () => ({
  auditBillingGuard: vi.fn(async (projectId: string) => ({
    projectId,
    billingEnabled: true,
    billingAccountId: "ABC-123",
    budgets: [],
    signals: ["Billing is enabled but no budgets were found."],
    risk: "missing_budget",
    recommendedAction: "Create a billing budget before running cost-bearing live operations.",
  })),
}));

vi.mock("../src/setup/apis.js", () => ({
  enableApis: enableApisMock,
}));

describe("budget command", () => {
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
});
