import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDeploy, type RunDeployOutcome } from "../src/cli/commands/deploy.js";
import { runFirestoreAudit, type RunFirestoreOutcome } from "../src/cli/commands/firestore.js";
import { runIamAudit, type RunIamOutcome } from "../src/cli/commands/iam.js";
import {
  runProjectDelete,
  type RunProjectOutcome,
} from "../src/cli/commands/project.js";
import {
  runSecretDelete,
  runSecretList,
  runSecretSet,
  type RunSecretOutcome,
} from "../src/cli/commands/secret.js";
import { runSecurityAudit, type RunSecurityOutcome } from "../src/cli/commands/security.js";
import { handleDeploy } from "../src/mcp/tools/deploy.js";
import { handleFirestoreAudit } from "../src/mcp/tools/firestore.js";
import { handleIamAudit } from "../src/mcp/tools/iam.js";
import { handleProjectDelete } from "../src/mcp/tools/project.js";
import {
  handleSecretDelete,
  handleSecretList,
  handleSecretSet,
} from "../src/mcp/tools/secret.js";
import { handleSecurityAudit } from "../src/mcp/tools/security.js";
import type { OmgResponse } from "../src/mcp/tools/types.js";
import { savePlan } from "../src/planner/schema.js";
import { generateDefaultProfile, saveProfile } from "../src/trust/profile.js";
import type { Plan } from "../src/types/plan.js";

const fixtures = vi.hoisted(() => ({
  budgetRisk: "configured" as "configured" | "review",
}));

const applyPlanMock = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  urls: { backend: "https://backend.example" },
  steps: [{ name: "backend", state: "completed", durationMs: 1 }],
})));

const secretConnectorMocks = vi.hoisted(() => ({
  listSecrets: vi.fn(async () => ({
    projectId: "demo-project",
    secrets: [{ name: "API_KEY", resourceName: "projects/demo-project/secrets/API_KEY" }],
  })),
  setSecret: vi.fn(async (input: { dryRun?: boolean }) =>
    input.dryRun
      ? {
          projectId: "demo-project",
          name: "API_KEY",
          dryRun: true,
          wouldCreateIfMissing: true,
          wouldAddVersion: true,
        }
      : {
          projectId: "demo-project",
          name: "API_KEY",
          created: false,
          versionAdded: true,
        },
  ),
  deleteSecret: vi.fn(async (input: { name: string; dryRun?: boolean }) =>
    input.dryRun
      ? {
          projectId: "demo-project",
          name: input.name,
          dryRun: true,
          wouldDelete: true,
        }
      : {
          projectId: "demo-project",
          name: input.name,
          deleted: true,
        },
  ),
}));

vi.mock("../src/executor/apply.js", () => ({
  applyPlan: applyPlanMock,
}));

vi.mock("../src/connectors/billing-audit.js", () => ({
  auditBillingGuard: vi.fn(async (projectId: string) => ({
    projectId,
    billingEnabled: true,
    billingAccountId: "ABC-123",
    budgets: fixtures.budgetRisk === "configured"
      ? [{ name: "budget-1", displayName: "Budget", thresholdPercents: [0.5, 0.9, 1] }]
      : [],
    signals: fixtures.budgetRisk === "configured"
      ? ["Budget configured: Budget."]
      : ["Billing is enabled, but no budget was visible."],
    risk: fixtures.budgetRisk,
    recommendedAction: fixtures.budgetRisk === "configured"
      ? "Budget guard is configured for this billing account."
      : "Create or grant access to a budget before live writes.",
  })),
}));

vi.mock("../src/connectors/secret-manager.js", () => secretConnectorMocks);

vi.mock("../src/connectors/project-audit.js", () => ({
  auditProject: vi.fn(async (projectId: string) => ({
    projectId,
    lifecycleState: "ACTIVE",
    billingEnabled: false,
    callerRoles: ["roles/owner"],
    enabledApis: [],
    firebaseLinked: false,
    signals: [],
    risk: "review",
    recommendedAction: "Review before cleanup.",
  })),
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

vi.mock("../src/connectors/iam-audit.js", () => ({
  auditIam: vi.fn(async (projectId: string) => ({
    projectId,
    bindings: [
      {
        role: "roles/owner",
        members: ["user:owner@example.com"],
        memberCount: 1,
        public: false,
        primitive: true,
      },
    ],
    serviceAccounts: [
      {
        email: "worker@demo-project.iam.gserviceaccount.com",
        displayName: "worker",
      },
    ],
    findings: [
      {
        severity: "review",
        reason: "Primitive project role should be reviewed before adding IAM automation.",
        role: "roles/owner",
      },
    ],
    inaccessible: [],
    signals: [
      "1 service account(s) visible.",
      "Primitive project role should be reviewed before adding IAM automation. Role: roles/owner.",
    ],
    risk: "review",
    recommendedAction: "Review privileged IAM bindings and service accounts before adding IAM writes.",
  })),
}));

vi.mock("../src/connectors/firestore-audit.js", () => ({
  auditFirestore: vi.fn(async (projectId: string) => ({
    projectId,
    databases: [
      {
        name: "projects/demo-project/databases/(default)",
        databaseId: "(default)",
        locationId: "nam5",
      },
    ],
    compositeIndexes: [],
    inaccessible: [],
    signals: ["1 Firestore database(s) visible."],
    risk: "review",
    recommendedAction: "Review Firestore databases before adding create, delete, export, import, or data mutation workflows.",
  })),
}));

vi.mock("../src/connectors/security-audit.js", () => ({
  auditSecurity: vi.fn(async (projectId: string) => ({
    projectId,
    sections: {
      project: { ok: true, risk: "low", signals: [], summary: { lifecycleState: "ACTIVE" } },
      iam: { ok: true, risk: "review", signals: ["Primitive role present."], summary: { findingCount: 1 } },
      budget: { ok: true, risk: "configured", signals: ["Budget configured."], summary: { budgetCount: 1 } },
    },
    signals: ["IAM: Primitive role present.", "Budget: Budget configured."],
    risk: "review",
    recommendedAction: "Review security audit findings before adding new live operations.",
  })),
}));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  fixtures.budgetRisk = "configured";
  vi.clearAllMocks();
});

describe("CLI/MCP command implementation equivalence", () => {
  it("returns the same deploy safety block through CLI and MCP surfaces", async () => {
    fixtures.budgetRisk = "review";
    const { cliCwd, mcpCwd } = await createPairedWorkspaces();
    await writeDeployFixtures(cliCwd, "dev");
    await writeDeployFixtures(mcpCwd, "dev");

    const cli = await runDeploy({ cwd: cliCwd, yes: true, jsonMode: true });
    const mcp = await withCwd(mcpCwd, () => handleDeploy({ yes: true }));

    expect(normalizeCliOutcome("deploy", cli)).toEqual(normalizeMcpResponse(mcp));
  });

  it("returns the same secret write confirmation requirement through CLI and MCP surfaces", async () => {
    const { cliCwd, mcpCwd } = await createPairedWorkspaces();
    await saveDefaultProfilePair(cliCwd, mcpCwd);

    const cli = await runSecretSet({
      cwd: cliCwd,
      name: "API_KEY",
      value: "super-secret-value",
      jsonMode: true,
    });
    const mcp = await withCwd(mcpCwd, () =>
      handleSecretSet({ name: "API_KEY", value: "super-secret-value" }),
    );

    expect(normalizeCliOutcome("secret:set", cli)).toEqual(normalizeMcpResponse(mcp));
    expect(JSON.stringify(cli)).not.toContain("super-secret-value");
    expect(JSON.stringify(mcp)).not.toContain("super-secret-value");
  });

  it("returns the same secret metadata listing through CLI and MCP surfaces", async () => {
    const { cliCwd, mcpCwd } = await createPairedWorkspaces();
    await saveDefaultProfilePair(cliCwd, mcpCwd);

    const cli = await runSecretList({ cwd: cliCwd, limit: 5 });
    const mcp = await withCwd(mcpCwd, () => handleSecretList({ limit: 5 }));

    expect(normalizeCliOutcome("secret:list", cli)).toEqual(normalizeMcpResponse(mcp));
  });

  it("returns the same secret delete confirmation requirement through CLI and MCP surfaces", async () => {
    const { cliCwd, mcpCwd } = await createPairedWorkspaces();
    await saveDefaultProfilePair(cliCwd, mcpCwd);

    const cli = await runSecretDelete({ cwd: cliCwd, name: "API_KEY" });
    const mcp = await withCwd(mcpCwd, () => handleSecretDelete({ name: "API_KEY" }));

    expect(normalizeCliOutcome("secret:delete", cli)).toEqual(normalizeMcpResponse(mcp));
  });

  it("returns the same project delete approval requirement through CLI and MCP surfaces", async () => {
    const { cliCwd, mcpCwd } = await createPairedWorkspaces();

    const cli = await runProjectDelete({
      cwd: cliCwd,
      project: "demo-project",
      requester: "agent",
    });
    const mcp = await withCwd(mcpCwd, () => handleProjectDelete({ project: "demo-project" }));

    expect(normalizeCliOutcome("project:delete", cli)).toEqual(normalizeMcpResponse(mcp));
  });

  it("returns the same IAM audit through CLI and MCP surfaces", async () => {
    const cli = await runIamAudit({ project: "demo-project" });
    const mcp = await handleIamAudit({ project: "demo-project" });

    expect(normalizeCliOutcome("iam:audit", cli)).toEqual(normalizeMcpResponse(mcp));
  });

  it("returns the same security audit through CLI and MCP surfaces", async () => {
    const cli = await runSecurityAudit({ project: "demo-project" });
    const mcp = await handleSecurityAudit({ project: "demo-project" });

    expect(normalizeCliOutcome("security:audit", cli)).toEqual(normalizeMcpResponse(mcp));
  });

  it("returns the same Firestore audit through CLI and MCP surfaces", async () => {
    const cli = await runFirestoreAudit({ project: "demo-project" });
    const mcp = await handleFirestoreAudit({ project: "demo-project" });

    expect(normalizeCliOutcome("firestore:audit", cli)).toEqual(normalizeMcpResponse(mcp));
  });
});

async function createPairedWorkspaces(): Promise<{ cliCwd: string; mcpCwd: string }> {
  const cliCwd = await createTempWorkspace("cli");
  const mcpCwd = await createTempWorkspace("mcp");
  return { cliCwd, mcpCwd };
}

async function createTempWorkspace(label: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `omg-equivalence-${label}-`));
  tempDirs.push(dir);
  return dir;
}

async function saveDefaultProfilePair(cliCwd: string, mcpCwd: string): Promise<void> {
  await saveProfile(cliCwd, generateDefaultProfile("demo-project", "dev"));
  await saveProfile(mcpCwd, generateDefaultProfile("demo-project", "dev"));
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

function normalizeCliOutcome(
  command: string,
  outcome:
    | RunDeployOutcome
    | RunSecretOutcome
    | RunProjectOutcome
    | RunIamOutcome
    | RunSecurityOutcome
    | RunFirestoreOutcome,
): unknown {
  if (outcome.ok) {
    return normalizeDynamicValues({
      ok: true,
      command,
      data: outcome.data,
      next: outcome.next,
    });
  }

  return normalizeDynamicValues({
    ok: false,
    command,
    data: outcome.error.data,
    error: {
      code: outcome.error.code,
      message: outcome.error.message,
      recoverable: outcome.error.recoverable,
      hint: outcome.error.hint,
    },
    next: outcome.error.next,
  });
}

function normalizeMcpResponse(response: OmgResponse): unknown {
  return normalizeDynamicValues(response);
}

function normalizeDynamicValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeDynamicValues);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === "approvalId" || key === "expiresAt"
          ? `<${key}>`
          : normalizeDynamicValues(entry),
      ]),
    );
  }

  if (typeof value === "string") {
    return value
      .replace(/apr_[A-Za-z0-9_-]+/g, "apr_<id>")
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<expiresAt>");
  }

  return value;
}

async function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const originalCwd = process.cwd;
  process.cwd = (() => cwd) as typeof process.cwd;

  try {
    return await fn();
  } finally {
    process.cwd = originalCwd;
  }
}
