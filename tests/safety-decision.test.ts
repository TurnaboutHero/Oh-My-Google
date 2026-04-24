import { describe, expect, it } from "vitest";
import { classifyOperation, type OperationIntent } from "../src/safety/intent.js";
import { evaluateSafety } from "../src/safety/decision.js";
import { generateDefaultProfile } from "../src/trust/profile.js";
import type { BillingGuardAudit } from "../src/connectors/billing-audit.js";

describe("shared safety decision wrapper", () => {
  it("allows dry-runs for budget-gated operations without budget evidence", async () => {
    const profile = generateDefaultProfile("demo-project", "dev");
    const intent = classifyOperation("deploy.cloud-run", { projectId: "demo-project" });

    const decision = await evaluateSafety(intent, profile, {
      cwd: process.cwd(),
      dryRun: true,
      jsonMode: true,
      yes: true,
    });

    expect(decision).toMatchObject({
      allowed: true,
      decision: "allow",
      code: "SAFETY_ALLOWED",
      budgetRequired: false,
    });
  });

  it("allows live budget-gated operations when budget guard is configured", async () => {
    const profile = generateDefaultProfile("demo-project", "dev");
    const intent = classifyOperation("deploy.cloud-run", { projectId: "demo-project" });

    const decision = await evaluateSafety(intent, profile, {
      cwd: process.cwd(),
      jsonMode: true,
      yes: true,
      budgetAudit: configuredBudget(),
    });

    expect(decision).toMatchObject({
      allowed: true,
      decision: "allow",
      code: "SAFETY_ALLOWED",
      budgetRequired: true,
    });
  });

  it("can fetch budget evidence only after trust allows execution", async () => {
    const profile = generateDefaultProfile("demo-project", "dev");
    const intent = classifyOperation("deploy.cloud-run", { projectId: "demo-project" });
    let auditCalls = 0;

    const decision = await evaluateSafety(intent, profile, {
      cwd: process.cwd(),
      jsonMode: true,
      yes: true,
      budgetAuditProvider: async (projectId) => {
        auditCalls += 1;
        expect(projectId).toBe("demo-project");
        return configuredBudget();
      },
    });

    expect(decision.allowed).toBe(true);
    expect(auditCalls).toBe(1);
  });

  it("blocks live budget-gated operations when budget guard is not configured", async () => {
    const profile = generateDefaultProfile("demo-project", "dev");
    const intent = classifyOperation("deploy.cloud-run", { projectId: "demo-project" });

    const decision = await evaluateSafety(intent, profile, {
      cwd: process.cwd(),
      jsonMode: true,
      yes: true,
      budgetAudit: {
        ...configuredBudget(),
        budgets: [],
        signals: ["Billing budgets could not be inspected."],
        risk: "review",
        recommendedAction: "Review billing budget visibility before running cost-bearing live operations.",
      },
    });

    expect(decision).toMatchObject({
      allowed: false,
      decision: "blocked",
      code: "BUDGET_GUARD_BLOCKED",
      budgetRisk: "review",
      budgetRequired: true,
      next: ["omg budget audit --project demo-project"],
    });
  });

  it("requires explicit confirmation when trust policy requires confirm in JSON mode", async () => {
    const profile = generateDefaultProfile("demo-project", "dev");
    const intent = classifyOperation("secret.set", { projectId: "demo-project" });

    const decision = await evaluateSafety(intent, profile, {
      cwd: process.cwd(),
      jsonMode: true,
      budgetAudit: configuredBudget(),
    });

    expect(decision).toMatchObject({
      allowed: false,
      decision: "require_confirm",
      code: "TRUST_REQUIRES_CONFIRM",
      budgetRequired: false,
    });
  });

  it("requires approval before budget checks when trust policy requires approval", async () => {
    const profile = generateDefaultProfile("demo-project", "prod");
    const intent = classifyOperation("deploy.cloud-run", { projectId: "demo-project" });

    let auditCalls = 0;
    const decision = await evaluateSafety(intent, profile, {
      cwd: process.cwd(),
      jsonMode: true,
      budgetAuditProvider: async () => {
        auditCalls += 1;
        return configuredBudget();
      },
    });

    expect(decision).toMatchObject({
      allowed: false,
      decision: "require_approval",
      code: "APPROVAL_REQUIRED",
      budgetRequired: false,
    });
    expect(auditCalls).toBe(0);
  });

  it("denies downstream MCP execution by default", async () => {
    const profile = generateDefaultProfile("demo-project", "dev");
    const intent: OperationIntent = {
      ...classifyOperation("unknown.service.write", { projectId: "demo-project" }),
      id: "downstream.firestore.deleteDocument",
      adapter: "downstream-mcp",
      destructive: true,
    };

    const decision = await evaluateSafety(intent, profile, {
      cwd: process.cwd(),
      jsonMode: true,
      yes: true,
      budgetAudit: configuredBudget(),
    });

    expect(decision).toMatchObject({
      allowed: false,
      decision: "deny",
      code: "ADAPTER_EXECUTION_DISABLED",
      budgetRequired: false,
    });
  });

  it("allows classified downstream MCP read proxy operations", async () => {
    const profile = generateDefaultProfile("demo-project", "dev");
    const intent = classifyOperation("downstream.mcp.read", {
      projectId: "demo-project",
      resource: "google/projects.list",
    });

    const decision = await evaluateSafety(intent, profile, {
      cwd: process.cwd(),
      jsonMode: true,
      yes: true,
    });

    expect(decision).toMatchObject({
      allowed: true,
      decision: "allow",
      code: "SAFETY_ALLOWED",
      budgetRequired: false,
    });
  });
});

function configuredBudget(): BillingGuardAudit {
  return {
    projectId: "demo-project",
    billingEnabled: true,
    billingAccountId: "ABC-123",
    budgets: [
      {
        name: "billingAccounts/ABC-123/budgets/1",
        displayName: "Monthly cap",
        thresholdPercents: [0.5, 0.9],
      },
    ],
    signals: ["Budget configured: Monthly cap."],
    risk: "configured",
    recommendedAction: "Budget guard is configured for this billing account.",
  };
}
