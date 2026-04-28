import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApproval, loadApproval, saveApproval } from "../src/approval/queue.js";
import { lockCost } from "../src/cost-lock/state.js";
import { savePlan } from "../src/planner/schema.js";
import { generateDefaultProfile, saveProfile } from "../src/trust/profile.js";
import type { Plan } from "../src/types/plan.js";

const deployFixtures = vi.hoisted(() => ({
  budgetRisk: "configured" as "configured" | "review" | "missing_budget" | "billing_disabled",
}));

const applyPlanMock = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  urls: { backend: "https://backend.example" },
  steps: [{ name: "backend", state: "completed", durationMs: 1 }],
})));

const auditBillingGuardMock = vi.hoisted(() => vi.fn(async (projectId: string) => ({
  projectId,
  billingEnabled: true,
  billingAccountId: "ABC-123",
  budgets: deployFixtures.budgetRisk === "configured"
    ? [{ name: "budget-1", displayName: "Budget", thresholdPercents: [0.5, 0.9, 1] }]
    : [],
  signals: deployFixtures.budgetRisk === "configured"
    ? ["Budget configured: Budget."]
    : ["Billing budgets could not be inspected."],
  risk: deployFixtures.budgetRisk,
  recommendedAction: deployFixtures.budgetRisk === "configured"
    ? "Budget guard is configured for this billing account."
    : "Review billing budget visibility before running cost-bearing live operations.",
})));

vi.mock("../src/executor/apply.js", () => ({
  applyPlan: applyPlanMock,
}));

vi.mock("../src/connectors/billing-audit.js", () => ({
  auditBillingGuard: auditBillingGuardMock,
}));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  deployFixtures.budgetRisk = "configured";
  applyPlanMock.mockClear();
  auditBillingGuardMock.mockClear();
});

describe("deploy budget guard", () => {
  it("does not audit budgets for dry-runs", async () => {
    const { runDeploy } = await import("../src/cli/commands/deploy.js");
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "dev");

    const result = await runDeploy({ cwd, dryRun: true, jsonMode: true });

    expect(result.ok).toBe(true);
    expect(auditBillingGuardMock).not.toHaveBeenCalled();
    expect(applyPlanMock).not.toHaveBeenCalled();
  });

  it("does not audit budgets when deploy is only creating an approval request", async () => {
    const { runDeploy } = await import("../src/cli/commands/deploy.js");
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "prod");

    const result = await runDeploy({ cwd, jsonMode: true });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("APPROVAL_REQUIRED");
    expect(auditBillingGuardMock).not.toHaveBeenCalled();
    expect(applyPlanMock).not.toHaveBeenCalled();
  });

  it("blocks live deploys when budget guard is not configured", async () => {
    deployFixtures.budgetRisk = "review";
    const { runDeploy } = await import("../src/cli/commands/deploy.js");
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "dev");

    const result = await runDeploy({ cwd, yes: true, jsonMode: true });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("BUDGET_GUARD_BLOCKED");
    expect(result.ok ? undefined : result.error.data?.budgetRisk).toBe("review");
    expect(auditBillingGuardMock).toHaveBeenCalledWith("demo-project");
    expect(applyPlanMock).not.toHaveBeenCalled();
  });

  it("blocks live deploys when local cost lock is active", async () => {
    const { runDeploy } = await import("../src/cli/commands/deploy.js");
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "dev");
    await lockCost(cwd, {
      projectId: "demo-project",
      reason: "budget alert threshold exceeded",
    });

    const result = await runDeploy({ cwd, yes: true, jsonMode: true });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("COST_LOCKED");
    expect(result.ok ? undefined : result.error.data?.reason).toBe("budget alert threshold exceeded");
    expect(auditBillingGuardMock).not.toHaveBeenCalled();
    expect(applyPlanMock).not.toHaveBeenCalled();
  });

  it("does not consume approved deploy approvals when budget guard blocks execution", async () => {
    deployFixtures.budgetRisk = "review";
    const { runDeploy } = await import("../src/cli/commands/deploy.js");
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "prod");
    const approval = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args: deployArgs("demo-api"),
      projectId: "demo-project",
      environment: "prod",
      requestedBy: "agent",
    });
    await saveApproval(cwd, {
      ...approval,
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await runDeploy({ cwd, approval: approval.id, jsonMode: true });
    const stored = await loadApproval(cwd, approval.id);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("BUDGET_GUARD_BLOCKED");
    expect(stored?.status).toBe("approved");
    expect(applyPlanMock).not.toHaveBeenCalled();
  });

  it("runs live deploys when budget guard is configured", async () => {
    const { runDeploy } = await import("../src/cli/commands/deploy.js");
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "dev");

    const result = await runDeploy({ cwd, yes: true, jsonMode: true });

    expect(result.ok).toBe(true);
    expect(auditBillingGuardMock).toHaveBeenCalledWith("demo-project");
    expect(applyPlanMock).toHaveBeenCalledTimes(1);
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-deploy-budget-"));
  tempDirs.push(dir);
  return dir;
}

function deployArgs(service: string): Record<string, unknown> {
  return {
    service,
    region: "asia-northeast3",
    image: "Dockerfile",
    port: 8080,
    runtime: "generic-docker",
    envKeys: [],
  };
}

async function writeDeployFixtures(cwd: string, environment: "dev" | "prod"): Promise<void> {
  const plan: Plan = {
    version: 1,
    detected: {
      stack: "api-only",
      backend: {
        type: "generic-docker",
        dockerfile: "Dockerfile",
        port: 8080,
      },
    },
    targets: {
      backend: {
        service: "cloud-run",
        serviceName: "demo-api",
        region: "asia-northeast3",
      },
    },
    wiring: [],
    environment: {
      backend: {},
      frontend: {},
    },
    deploymentOrder: ["backend"],
    checks: ["Cloud Run target resolved"],
    warnings: [],
  };

  await savePlan(cwd, plan);
  await saveProfile(cwd, generateDefaultProfile("demo-project", environment));
}
