import { describe, expect, it, vi } from "vitest";
import {
  handleBudgetAudit,
  handleBudgetEnsure,
  handleBudgetNotificationsAudit,
  handleBudgetNotificationsEnsure,
  handleBudgetNotificationsLockIngestion,
} from "../src/mcp/tools/budget.js";

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
  runBudgetEnsure: vi.fn(async () => ({
    ok: true,
    data: {
      projectId: "demo-project",
      action: "create",
      dryRun: true,
      liveMutation: false,
    },
    next: ["Review this dry-run plan before enabling live budget mutation."],
  })),
  runBudgetNotificationsAudit: vi.fn(async () => ({
    ok: true,
    data: {
      projectId: "demo-project",
      posture: "none",
      budgetCount: 1,
    },
    next: ["omg budget notifications ensure --project demo-project --topic <topic> --dry-run"],
  })),
  runBudgetNotificationsEnsure: vi.fn(async () => ({
    ok: true,
    data: {
      projectId: "demo-project",
      action: "update",
      dryRun: true,
      liveMutation: false,
    },
    next: ["Review this dry-run plan before enabling live budget notification mutation."],
  })),
  runBudgetNotificationsLockIngestion: vi.fn(async () => ({
    ok: true,
    data: {
      projectId: "demo-project",
      status: "ready",
      liveMutation: false,
    },
    next: ["Review handler responsibilities before live setup."],
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

  it("returns budget ensure dry-run output", async () => {
    const result = await handleBudgetEnsure({
      project: "demo-project",
      amount: "50000",
      currency: "KRW",
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("budget:ensure");
    expect(result.data?.action).toBe("create");
  });

  it("returns budget notification audit output", async () => {
    const result = await handleBudgetNotificationsAudit({
      project: "demo-project",
      topic: "budget-alerts",
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("budget:notifications:audit");
    expect(result.data?.posture).toBe("none");
  });

  it("returns budget notification ensure dry-run output", async () => {
    const result = await handleBudgetNotificationsEnsure({
      project: "demo-project",
      topic: "budget-alerts",
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("budget:notifications:ensure");
    expect(result.data?.action).toBe("update");
  });

  it("returns budget notification lock ingestion dry-run output", async () => {
    const result = await handleBudgetNotificationsLockIngestion({
      project: "demo-project",
      topic: "budget-alerts",
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("budget:notifications:lock-ingestion");
    expect(result.data?.status).toBe("ready");
  });

  it("validates budget ensure MCP arguments", async () => {
    const result = await handleBudgetEnsure({
      project: "demo-project",
      amount: "50000",
      currency: "KRW",
      nope: true,
    });

    expect(result.ok).toBe(false);
    expect(result.command).toBe("budget:ensure");
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });

  it("validates budget notification lock ingestion MCP arguments under the right command", async () => {
    const result = await handleBudgetNotificationsLockIngestion({
      project: "demo-project",
      topic: "budget-alerts",
      nope: true,
    });

    expect(result.ok).toBe(false);
    expect(result.command).toBe("budget:notifications:lock-ingestion");
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});
