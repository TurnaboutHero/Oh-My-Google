import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { savePlan } from "../src/planner/schema.js";
import { generateDefaultProfile, saveProfile } from "../src/trust/profile.js";
import type { Plan } from "../src/types/plan.js";

const safetyMock = vi.hoisted(() => ({
  evaluateSafety: vi.fn(),
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
  budgets: [{ name: "budget-1", displayName: "Budget", thresholdPercents: [0.5, 0.9, 1] }],
  signals: ["Budget configured: Budget."],
  risk: "configured",
  recommendedAction: "Budget guard is configured for this billing account.",
})));

const setSecretMock = vi.hoisted(() => vi.fn(async () => ({
  projectId: "demo-project",
  name: "API_KEY",
  created: false,
  versionAdded: true,
})));

const auditProjectMock = vi.hoisted(() => vi.fn(async (projectId: string) => ({
  projectId,
  lifecycleState: "ACTIVE",
  billingEnabled: false,
  callerRoles: ["roles/owner"],
  enabledApis: [],
  firebaseLinked: false,
  signals: [],
  risk: "review",
  recommendedAction: "Review before cleanup.",
})));

vi.mock("../src/safety/decision.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/safety/decision.js")>();
  safetyMock.evaluateSafety.mockImplementation(actual.evaluateSafety);
  return {
    ...actual,
    evaluateSafety: safetyMock.evaluateSafety,
  };
});

vi.mock("../src/executor/apply.js", () => ({
  applyPlan: applyPlanMock,
}));

vi.mock("../src/connectors/billing-audit.js", () => ({
  auditBillingGuard: auditBillingGuardMock,
}));

vi.mock("../src/connectors/secret-manager.js", () => ({
  listSecrets: vi.fn(async () => ({ projectId: "demo-project", secrets: [] })),
  setSecret: setSecretMock,
  deleteSecret: vi.fn(async () => ({ projectId: "demo-project", deleted: true })),
}));

vi.mock("../src/connectors/project-audit.js", () => ({
  auditProject: auditProjectMock,
  buildCleanupPlan: vi.fn(),
  deleteProject: vi.fn(async (projectId: string) => ({
    projectId,
    lifecycleState: "DELETE_REQUESTED",
  })),
  readActiveGcloudAccount: vi.fn(async () => "owner@example.com"),
  readProjectLifecycle: vi.fn(async (projectId: string) => ({
    projectId,
    lifecycleState: "DELETE_REQUESTED",
  })),
  undeleteProject: vi.fn(async (projectId: string) => ({
    projectId,
    lifecycleState: "ACTIVE",
  })),
}));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe("command adoption of shared safety decision", () => {
  it("routes live deploy safety through evaluateSafety", async () => {
    const { runDeploy } = await import("../src/cli/commands/deploy.js");
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "dev");

    const result = await runDeploy({ cwd, yes: true, jsonMode: true });

    expect(result.ok).toBe(true);
    expect(safetyMock.evaluateSafety).toHaveBeenCalledTimes(1);
    expect(safetyMock.evaluateSafety.mock.calls[0]?.[0]).toMatchObject({
      id: "deploy.cloud-run",
      projectId: "demo-project",
      requiresBudget: true,
    });
    expect(applyPlanMock).toHaveBeenCalledTimes(1);
  });

  it("routes live secret writes through evaluateSafety", async () => {
    const { runSecretSet } = await import("../src/cli/commands/secret.js");
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await runSecretSet({
      cwd,
      name: "API_KEY",
      value: "super-secret-value",
      yes: true,
      jsonMode: true,
    });

    expect(result.ok).toBe(true);
    expect(safetyMock.evaluateSafety).toHaveBeenCalledTimes(1);
    expect(safetyMock.evaluateSafety.mock.calls[0]?.[0]).toMatchObject({
      id: "secret.set",
      projectId: "demo-project",
      secretTouching: true,
      requiresBudget: true,
    });
    expect(setSecretMock).toHaveBeenCalledTimes(1);
  });

  it("routes read-only secret listing through evaluateSafety", async () => {
    const { runSecretList } = await import("../src/cli/commands/secret.js");
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await runSecretList({ cwd });

    expect(result.ok).toBe(true);
    expect(safetyMock.evaluateSafety).toHaveBeenCalledTimes(1);
    expect(safetyMock.evaluateSafety.mock.calls[0]?.[0]).toMatchObject({
      id: "secret.list",
      projectId: "demo-project",
      requiresBudget: false,
    });
  });

  it("routes project deletion approval checks through evaluateSafety", async () => {
    const { runProjectDelete } = await import("../src/cli/commands/project.js");
    const cwd = await createTempWorkspace();

    const result = await runProjectDelete({
      cwd,
      project: "demo-project",
      requester: "agent",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("APPROVAL_REQUIRED");
    expect(safetyMock.evaluateSafety).toHaveBeenCalledTimes(1);
    expect(safetyMock.evaluateSafety.mock.calls[0]?.[0]).toMatchObject({
      id: "gcp.project.delete",
      projectId: "demo-project",
      destructive: true,
    });
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-command-safety-"));
  tempDirs.push(dir);
  return dir;
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
