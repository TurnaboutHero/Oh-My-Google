import { describe, expect, it, vi } from "vitest";
import { projectCommand } from "../src/cli/commands/project.js";
import { setOutputFormat } from "../src/cli/output.js";

vi.mock("../src/connectors/project-audit.js", () => ({
  auditProject: vi.fn(async (projectId: string) => ({
    projectId,
    risk: projectId === "quadratic-signifier-fmd0t" ? "do_not_touch" : "review",
    signals: ["Billing is enabled."],
    recommendedAction: "Do not modify this project until ownership and billing responsibility are confirmed.",
  })),
  buildCleanupPlan: vi.fn((audit: { projectId: string }) => ({
    projectId: audit.projectId,
    dryRun: true,
    allowedToExecute: false,
    steps: ["Review project ownership and enabled APIs in Google Cloud Console."],
    next: ["No automated cleanup command is available."],
  })),
}));

describe("project command", () => {
  it("returns project audit output in JSON mode", async () => {
    const result = await runProjectCli(["audit", "--project", "quadratic-signifier-fmd0t"]);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      data?: { risk?: string };
    };

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("project:audit");
    expect(payload.data?.risk).toBe("do_not_touch");
  });

  it("returns dry-run cleanup plan only", async () => {
    const result = await runProjectCli(["cleanup", "--project", "citric-optics-380903", "--dry-run"]);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      command: string;
      data?: { allowedToExecute?: boolean; dryRun?: boolean };
    };

    expect(result.exitCode).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("project:cleanup");
    expect(payload.data?.dryRun).toBe(true);
    expect(payload.data?.allowedToExecute).toBe(false);
  });

  it("rejects cleanup without dry-run", async () => {
    const result = await runProjectCli(["cleanup", "--project", "citric-optics-380903"]);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
    };

    expect(result.exitCode).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("VALIDATION_ERROR");
  });
});

async function runProjectCli(
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
    await projectCommand.parseAsync(args, { from: "user" });
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
