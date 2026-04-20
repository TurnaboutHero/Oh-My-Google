import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApproval, loadApproval, saveApproval } from "../src/approval/queue.js";
import { secretCommand } from "../src/cli/commands/secret.js";
import { setOutputFormat } from "../src/cli/output.js";
import { saveProfile, generateDefaultProfile } from "../src/trust/profile.js";

const secretFixtures = vi.hoisted(() => ({
  budgetRisk: "configured",
}));

vi.mock("../src/connectors/secret-manager.js", () => ({
  listSecrets: vi.fn(async () => ({
    projectId: "demo-project",
    secrets: [{ name: "API_KEY", resourceName: "projects/demo-project/secrets/API_KEY" }],
  })),
  setSecret: vi.fn(async () => ({
    projectId: "demo-project",
    name: "API_KEY",
    created: false,
    versionAdded: true,
  })),
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

vi.mock("../src/connectors/billing-audit.js", () => ({
  auditBillingGuard: vi.fn(async (projectId: string) => ({
    projectId,
    billingEnabled: true,
    billingAccountId: "ABC-123",
    budgets: secretFixtures.budgetRisk === "configured"
      ? [{ name: "budget-1", displayName: "Budget", thresholdPercents: [0.5, 0.9, 1] }]
      : [],
    signals: [],
    risk: secretFixtures.budgetRisk,
    recommendedAction: secretFixtures.budgetRisk === "configured"
      ? "Budget guard is configured for this billing account."
      : "Review billing budget visibility before running cost-bearing live operations.",
  })),
}));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  secretFixtures.budgetRisk = "configured";
  vi.clearAllMocks();
});

describe("secret command", () => {
  it("does not require trust confirmation for dry-run secret writes", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await runSecretCli(["set", "API_KEY", "--value", "super-secret-value", "--dry-run"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      data?: Record<string, unknown>;
    };

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("super-secret-value");

    const billingAudit = await import("../src/connectors/billing-audit.js");
    expect(billingAudit.auditBillingGuard).not.toHaveBeenCalled();
  });

  it("requires --yes for dev secret writes in JSON mode", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await runSecretCli(["set", "API_KEY", "--value", "super-secret-value"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
      next?: string[];
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("TRUST_REQUIRES_CONFIRM");
    expect(payload.next).toEqual(["omg secret set API_KEY --yes"]);
    expect(JSON.stringify(payload)).not.toContain("super-secret-value");
  });

  it("sets a secret after trust confirmation without echoing the value", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await runSecretCli(["set", "API_KEY", "--value", "super-secret-value", "--yes"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      data?: Record<string, unknown>;
    };

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("secret:set");
    expect(payload.data).toMatchObject({
      projectId: "demo-project",
      name: "API_KEY",
      versionAdded: true,
    });
    expect(JSON.stringify(payload)).not.toContain("super-secret-value");

    const billingAudit = await import("../src/connectors/billing-audit.js");
    expect(billingAudit.auditBillingGuard).toHaveBeenCalledWith("demo-project");
  });

  it("blocks live secret writes when budget guard is not configured", async () => {
    secretFixtures.budgetRisk = "review";
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await runSecretCli(["set", "API_KEY", "--value", "super-secret-value", "--yes"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
      data?: { budgetRisk?: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("BUDGET_GUARD_BLOCKED");
    expect(payload.data?.budgetRisk).toBe("review");
    expect(JSON.stringify(payload)).not.toContain("super-secret-value");
  });

  it("does not consume approved secret write approvals when budget guard blocks execution", async () => {
    secretFixtures.budgetRisk = "review";
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "prod"));
    const approval = await createApproval(cwd, {
      action: "secret.set",
      args: { projectId: "demo-project", name: "API_KEY", source: "inline-value" },
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

    const result = await runSecretCli([
      "set",
      "API_KEY",
      "--value",
      "super-secret-value",
      "--approval",
      approval.id,
    ], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
    };
    const stored = await loadApproval(cwd, approval.id);

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("BUDGET_GUARD_BLOCKED");
    expect(stored?.status).toBe("approved");
    expect(JSON.stringify(payload)).not.toContain("super-secret-value");
  });

  it("lists secrets as metadata only", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await runSecretCli(["list", "--limit", "5"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      data?: { secrets?: unknown[] };
    };

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("secret:list");
    expect(payload.data?.secrets).toHaveLength(1);
  });

  it("dry-runs secret deletion", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await runSecretCli(["delete", "API_KEY", "--dry-run"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      data?: { dryRun?: boolean; wouldDelete?: boolean };
    };

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("secret:delete");
    expect(payload.data?.dryRun).toBe(true);
    expect(payload.data?.wouldDelete).toBe(true);
  });

  it("requires yes for secret deletion", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await runSecretCli(["delete", "API_KEY"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("TRUST_REQUIRES_CONFIRM");
  });

  it("deletes a secret with explicit yes", async () => {
    const cwd = await createTempWorkspace();
    await saveProfile(cwd, generateDefaultProfile("demo-project", "dev"));

    const result = await runSecretCli(["delete", "API_KEY", "--yes"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      data?: { deleted?: boolean };
    };

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("secret:delete");
    expect(payload.data?.deleted).toBe(true);
  });

  it("honors deny policy for secret metadata listing", async () => {
    const cwd = await createTempWorkspace();
    const profile = generateDefaultProfile("demo-project", "dev");
    profile.deny = ["secret.*"];
    await saveProfile(cwd, profile);

    const result = await runSecretCli(["list"], cwd);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("TRUST_DENIED");
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-secret-command-"));
  tempDirs.push(dir);
  return dir;
}

async function runSecretCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalCwd = process.cwd;
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;
  let exitCode = 0;

  console.log = (...values: unknown[]) => {
    stdout.push(values.join(" "));
  };
  console.error = (...values: unknown[]) => {
    stderr.push(values.join(" "));
  };
  process.exit = ((code?: string | number | null) => {
    exitCode = typeof code === "number" ? code : 1;
    throw new CliExit(exitCode);
  }) as typeof process.exit;

  try {
    setOutputFormat("json");
    process.cwd = (() => cwd) as typeof process.cwd;
    await secretCommand.parseAsync(args, { from: "user" });
  } catch (error) {
    if (!(error instanceof CliExit)) {
      throw error;
    }
  } finally {
    process.cwd = originalCwd;
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
    setOutputFormat("human");
  }

  return {
    stdout: (stdout[0] ?? "").trim(),
    stderr: stderr.join("\n").trim(),
    exitCode,
  };
}

class CliExit extends Error {
  constructor(public readonly code: number) {
    super("CLI exited");
  }
}
