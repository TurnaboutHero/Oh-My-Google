import { describe, expect, it, vi } from "vitest";
import { handleBudgetAudit } from "../src/mcp/tools/budget.js";

vi.mock("../src/cli/commands/budget.js", () => ({
  runBudgetAudit: vi.fn(async () => ({
    ok: true,
    data: {
      projectId: "demo-project",
      billingEnabled: true,
      billingAccountId: "ABC-123",
      budgets: [],
      signals: ["Billing is enabled but no budgets were found."],
      risk: "missing_budget",
      recommendedAction: "Create a billing budget before running cost-bearing live operations.",
    },
    next: ["Create a billing budget for billing account ABC-123."],
  })),
}));

describe("omg.budget MCP tools", () => {
  it("returns budget audit output", async () => {
    const result = await handleBudgetAudit({ project: "demo-project" });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("budget:audit");
    expect(result.data?.risk).toBe("missing_budget");
  });

  it("rejects unknown arguments", async () => {
    const result = await handleBudgetAudit({ project: "demo-project", nope: true });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});
