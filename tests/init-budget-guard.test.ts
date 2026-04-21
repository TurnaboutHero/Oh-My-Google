import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initFixtures = vi.hoisted(() => ({
  billingGuard: {
    projectId: "demo-project",
    billingEnabled: true,
    billingAccountId: "ABC-123",
    budgets: [],
    signals: ["Billing is enabled but no budgets were found."],
    risk: "missing_budget",
    recommendedAction: "Create a billing budget before running cost-bearing live operations.",
  },
  billingStatus: {
    linked: false,
    billingAccountId: undefined as string | undefined,
  },
  projects: [{ projectId: "demo-project", name: "Demo Project" }],
  enableApis: vi.fn(async () => undefined),
  linkBilling: vi.fn(async () => undefined),
  applyBindings: vi.fn(async () => undefined),
  saveConfig: vi.fn(async () => undefined),
  saveProfile: vi.fn(async () => undefined),
  auditBillingAccountGuard: vi.fn(async () => initFixtures.billingGuard),
  auditBillingGuard: vi.fn(async () => initFixtures.billingGuard),
}));

vi.mock("../src/system/cli-runner.js", () => ({
  execCliFile: vi.fn(async (command: string, args: string[]) => {
    if (command === "gcloud" && args[0] === "--version") {
      return { stdout: "Google Cloud SDK 551.0.0\n", stderr: "" };
    }
    if (command === "gcloud" && args.join(" ") === "config get-value account --format=json") {
      return { stdout: "\"cli@example.com\"\n", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  }),
}));

vi.mock("../src/auth/auth-manager.js", () => ({
  AuthManager: class {
    static saveConfig = initFixtures.saveConfig;

    async status() {
      return {
        projectId: null,
        adcConfigured: true,
        adcAccount: "cli@example.com",
        gcloudAccount: "cli@example.com",
        gcp: true,
      };
    }
  },
}));

vi.mock("../src/setup/project.js", () => ({
  listProjects: vi.fn(async () => initFixtures.projects),
  createProject: vi.fn(async () => undefined),
  setActiveProject: vi.fn(async () => undefined),
}));

vi.mock("../src/setup/billing.js", () => ({
  getBillingStatus: vi.fn(async () => initFixtures.billingStatus),
  linkBilling: initFixtures.linkBilling,
  listBillingAccounts: vi.fn(async () => []),
}));

vi.mock("../src/setup/apis.js", () => ({
  DEFAULT_APIS: [
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
  ],
  enableApis: initFixtures.enableApis,
}));

vi.mock("../src/setup/iam.js", () => ({
  proposeDefaultRoles: vi.fn(async () => [
    {
      principal: "user:cli@example.com",
      role: "roles/run.admin",
      reason: "Allows Cloud Run deployments.",
    },
  ]),
  applyBindings: initFixtures.applyBindings,
}));

vi.mock("../src/trust/profile.js", async () => {
  const actual = await vi.importActual<typeof import("../src/trust/profile.js")>(
    "../src/trust/profile.js",
  );
  return {
    ...actual,
    saveProfile: initFixtures.saveProfile,
  };
});

vi.mock("../src/connectors/billing-audit.js", () => ({
  auditBillingAccountGuard: initFixtures.auditBillingAccountGuard,
  auditBillingGuard: initFixtures.auditBillingGuard,
}));

const tempDirs: string[] = [];

beforeEach(() => {
  initFixtures.billingGuard = {
    projectId: "demo-project",
    billingEnabled: true,
    billingAccountId: "ABC-123",
    budgets: [],
    signals: ["Billing is enabled but no budgets were found."],
    risk: "missing_budget",
    recommendedAction: "Create a billing budget before running cost-bearing live operations.",
  };
  initFixtures.billingStatus = {
    linked: false,
    billingAccountId: undefined,
  };
  initFixtures.projects = [{ projectId: "demo-project", name: "Demo Project" }];
  initFixtures.enableApis.mockClear();
  initFixtures.linkBilling.mockClear();
  initFixtures.applyBindings.mockClear();
  initFixtures.saveConfig.mockClear();
  initFixtures.saveProfile.mockClear();
  initFixtures.auditBillingAccountGuard.mockClear();
  initFixtures.auditBillingGuard.mockClear();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("init budget guard", () => {
  it("blocks before billing link and API enable when the selected billing account has no budget", async () => {
    const { runInit } = await import("../src/cli/commands/init.js");
    const cwd = await createTempWorkspace();

    const result = await runInit({
      cwd,
      projectId: "demo-project",
      billingAccount: "ABC-123",
      environment: "dev",
      region: "asia-northeast3",
      jsonMode: true,
      interactive: false,
      yes: true,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("BUDGET_GUARD_BLOCKED");
    expect(result.ok ? undefined : result.error.data?.risk).toBe("missing_budget");
    expect(initFixtures.auditBillingAccountGuard).toHaveBeenCalledWith(
      "demo-project",
      "ABC-123",
    );
    expect(initFixtures.linkBilling).not.toHaveBeenCalled();
    expect(initFixtures.enableApis).not.toHaveBeenCalled();
    expect(initFixtures.applyBindings).not.toHaveBeenCalled();
    expect(initFixtures.saveConfig).not.toHaveBeenCalled();
    expect(initFixtures.saveProfile).not.toHaveBeenCalled();
  });

  it("continues first-run init when the selected billing account has a configured budget", async () => {
    initFixtures.billingGuard = {
      ...initFixtures.billingGuard,
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
    const { runInit } = await import("../src/cli/commands/init.js");
    const cwd = await createTempWorkspace();

    const result = await runInit({
      cwd,
      projectId: "demo-project",
      billingAccount: "ABC-123",
      environment: "dev",
      region: "asia-northeast3",
      jsonMode: true,
      interactive: false,
      yes: true,
    });

    expect(result.ok).toBe(true);
    expect(initFixtures.auditBillingAccountGuard).toHaveBeenCalledWith(
      "demo-project",
      "ABC-123",
    );
    expect(initFixtures.linkBilling).toHaveBeenCalledWith("demo-project", "ABC-123");
    expect(initFixtures.enableApis).toHaveBeenCalled();
    expect(initFixtures.applyBindings).toHaveBeenCalled();
    expect(initFixtures.saveConfig).toHaveBeenCalled();
    expect(initFixtures.saveProfile).toHaveBeenCalled();
  });

  it("blocks before billing link when budget visibility requires review", async () => {
    initFixtures.billingGuard = {
      ...initFixtures.billingGuard,
      inaccessible: ["billing budgets"],
      signals: ["Billing budgets could not be inspected."],
      risk: "review",
      recommendedAction: "Review billing budget visibility before running cost-bearing live operations.",
    };
    const { runInit } = await import("../src/cli/commands/init.js");
    const cwd = await createTempWorkspace();

    const result = await runInit({
      cwd,
      projectId: "demo-project",
      billingAccount: "ABC-123",
      environment: "dev",
      region: "asia-northeast3",
      jsonMode: true,
      interactive: false,
      yes: true,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("BUDGET_GUARD_BLOCKED");
    expect(result.ok ? undefined : result.error.data?.risk).toBe("review");
    expect(result.ok ? undefined : result.error.next).toContain(
      "omg budget enable-api --project demo-project --dry-run",
    );
    expect(initFixtures.linkBilling).not.toHaveBeenCalled();
    expect(initFixtures.enableApis).not.toHaveBeenCalled();
  });

  it("audits the project guard and skips relinking when the requested billing account is already linked", async () => {
    initFixtures.billingStatus = {
      linked: true,
      billingAccountId: "ABC-123",
    };
    initFixtures.billingGuard = {
      ...initFixtures.billingGuard,
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
    const { runInit } = await import("../src/cli/commands/init.js");
    const cwd = await createTempWorkspace();

    const result = await runInit({
      cwd,
      projectId: "demo-project",
      billingAccount: "ABC-123",
      environment: "dev",
      region: "asia-northeast3",
      jsonMode: true,
      interactive: false,
      yes: true,
    });

    expect(result.ok).toBe(true);
    expect(initFixtures.auditBillingGuard).toHaveBeenCalledWith("demo-project");
    expect(initFixtures.auditBillingAccountGuard).not.toHaveBeenCalled();
    expect(initFixtures.linkBilling).not.toHaveBeenCalled();
    expect(initFixtures.enableApis).toHaveBeenCalled();
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-init-budget-guard-"));
  tempDirs.push(dir);
  return dir;
}
