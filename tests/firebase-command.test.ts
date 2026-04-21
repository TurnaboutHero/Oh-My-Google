import { afterEach, describe, expect, it, vi } from "vitest";
import { firebaseCommand } from "../src/cli/commands/firebase.js";
import { setOutputFormat } from "../src/cli/output.js";

const firebaseFixtures = vi.hoisted(() => ({
  budgetRisk: "configured" as "configured" | "review" | "missing_budget" | "billing_disabled",
}));

const firebaseExecuteMock = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  data: {
    dryRun: false,
    command: "firebase",
    args: ["deploy", "--only", "hosting"],
  },
  metadata: {
    connector: "firebase",
    action: "hosting.deploy",
    durationMs: 1,
    timestamp: new Date().toISOString(),
  },
})));

const auditBillingGuardMock = vi.hoisted(() => vi.fn(async (projectId: string) => ({
  projectId,
  billingEnabled: true,
  billingAccountId: "ABC-123",
  budgets: firebaseFixtures.budgetRisk === "configured"
    ? [{ name: "budget-1", displayName: "Budget", thresholdPercents: [0.5, 0.9, 1] }]
    : [],
  signals: firebaseFixtures.budgetRisk === "configured"
    ? ["Budget configured: Budget."]
    : ["Billing budgets could not be inspected."],
  risk: firebaseFixtures.budgetRisk,
  recommendedAction: firebaseFixtures.budgetRisk === "configured"
    ? "Budget guard is configured for this billing account."
    : "Review billing budget visibility before running cost-bearing live operations.",
})));

vi.mock("../src/auth/auth-manager.js", () => ({
  AuthManager: class {
    async status() {
      return { projectId: "demo-project", gcp: true };
    }
  },
}));

vi.mock("../src/connectors/firebase.js", () => ({
  firebaseConnector: {
    execute: firebaseExecuteMock,
  },
}));

vi.mock("../src/connectors/billing-audit.js", () => ({
  auditBillingGuard: auditBillingGuardMock,
}));

afterEach(() => {
  firebaseFixtures.budgetRisk = "configured";
  firebaseExecuteMock.mockClear();
  auditBillingGuardMock.mockClear();
});

describe("firebase command budget guard", () => {
  it("does not audit budgets for dry-run deploys", async () => {
    const result = await runFirebaseCli(["deploy", "--output", "json", "--dry-run"]);
    const payload = JSON.parse(result.stdout) as { ok: boolean; command: string };

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("firebase:deploy");
    expect(auditBillingGuardMock).not.toHaveBeenCalled();
    expect(firebaseExecuteMock).toHaveBeenCalledTimes(1);
  });

  it("blocks live Firebase deploys when budget guard is not configured", async () => {
    firebaseFixtures.budgetRisk = "review";

    const result = await runFirebaseCli(["deploy", "--output", "json", "--execute", "--yes"]);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("BUDGET_GUARD_BLOCKED");
    expect(auditBillingGuardMock).toHaveBeenCalledWith("demo-project");
    expect(firebaseExecuteMock).not.toHaveBeenCalled();
  });

  it("runs live Firebase deploys when budget guard is configured", async () => {
    const result = await runFirebaseCli(["deploy", "--output", "json", "--execute", "--yes"]);
    const payload = JSON.parse(result.stdout) as { ok: boolean; command: string };

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("firebase:deploy");
    expect(auditBillingGuardMock).toHaveBeenCalledWith("demo-project");
    expect(firebaseExecuteMock).toHaveBeenCalledTimes(1);
  });
});

async function runFirebaseCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
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
    await firebaseCommand.parseAsync(args, { from: "user" });
  } catch (error) {
    if (!(error instanceof CliExit)) {
      throw error;
    }
  } finally {
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
