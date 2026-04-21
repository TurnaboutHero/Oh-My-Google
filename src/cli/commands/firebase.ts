import path from "node:path";
import { Command } from "commander";
import { AuthManager } from "../../auth/auth-manager.js";
import { auditBillingGuard } from "../../connectors/billing-audit.js";
import { firebaseConnector } from "../../connectors/firebase.js";
import { spawnCliSync } from "../../system/cli-runner.js";
import type {
  ConnectorResult,
  ConnectorConfig,
} from "../../types/connector.js";
import {
  AuthError,
  CliRunnerError,
  OmgError,
  ValidationError,
} from "../../types/errors.js";
import {
  type OutputFormat,
  getOutputFormat,
  setOutputFormat,
  success,
  fail,
} from "../output.js";
import type {
  FirebaseAction,
  FirebaseCommandResult,
} from "../../connectors/firebase.js";

export const firebaseCommand = new Command("firebase")
  .description("Manage Firebase workflows");

firebaseCommand
  .command("init")
  .description("Initialize Firebase in the current workspace")
  .option("--project <id>", "Firebase project ID")
  .option("--cwd <path>", "Working directory", ".")
  .option("--output <format>", "Output format: human or json", "human")
  .option("--dry-run", "Show init plan without executing")
  .action(async (opts) => {
    setOutputFormat(normalizeOutputFormat(opts.output));

    try {
      const projectId = await resolveProjectId(opts.project as string | undefined);
      const cwd = path.resolve(opts.cwd as string);
      const dryRun = !!opts.dryRun;
      const args = ["init", "--project", projectId];

      printPlan("Firebase Init Plan", {
        project: projectId,
        cwd,
        dryRun,
        command: `firebase ${args.join(" ")}`,
      });

      if (dryRun) {
        success("firebase:init", "Firebase init plan ready.", {
          projectId,
          cwd,
          dryRun,
          command: "firebase",
          args,
        });
        return;
      }

      const run = runFirebaseCli(args, cwd);
      if (run.error || run.status !== 0) {
        throw new CliRunnerError(
          "Firebase init failed.",
          run.status ?? 1,
          extractStderr(run),
        );
      }

      success("firebase:init", "Firebase init completed.", {
        projectId,
        cwd,
        dryRun,
        command: "firebase",
        args,
        stdout: extractStdout(run),
      });
    } catch (error) {
      emitCommandError("firebase:init", error);
    }
  });

firebaseCommand
  .command("deploy")
  .description("Deploy Firebase Hosting or Functions")
  .option("--target <target>", "Deploy target: hosting or functions", "hosting")
  .option("--project <id>", "Firebase project ID")
  .option("--cwd <path>", "Working directory", ".")
  .option("--config <path>", "Path to firebase.json")
  .option("--only <targets>", "Override Firebase --only selector")
  .option("--output <format>", "Output format: human or json", "human")
  .option("--dry-run", "Show deployment plan without executing")
  .option("--execute", "Execute deployment instead of dry-run")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (opts) => {
    setOutputFormat(normalizeOutputFormat(opts.output));

    try {
      const projectId = await resolveProjectId(opts.project as string | undefined);
      const target = resolveDeployTarget(opts.target as string | undefined);
      const action: FirebaseAction =
        target === "functions" ? "functions.deploy" : "hosting.deploy";
      const dryRun = !opts.execute || !!opts.dryRun;
      const cwd = path.resolve(opts.cwd as string);

      printPlan("Firebase Deployment Plan", {
        project: projectId,
        target,
        cwd,
        dryRun,
        config: (opts.config as string | undefined) ?? "(default)",
        only: (opts.only as string | undefined) ?? target,
      });

      if (!dryRun && !opts.yes) {
        const confirmed = await confirm(
          `Deploy ${target} to Firebase project ${projectId}? (y/N) `,
        );
        if (!confirmed) {
          success("firebase:deploy", "Deployment cancelled.", {
            projectId,
            target,
            cancelled: true,
          });
          return;
        }
      }

      if (!dryRun) {
        await assertBudgetGuard(projectId, "Firebase deployment");
      }

      const config: ConnectorConfig = { project: { projectId } };
      const result = await firebaseConnector.execute(
        action,
        {
          cwd,
          configPath: opts.config as string | undefined,
          dryRun,
          only: opts.only as string | undefined,
        },
        config,
      );

      emitConnectorResult(
        "firebase:deploy",
        result,
        dryRun
          ? `Firebase ${target} deployment plan ready.`
          : `Firebase ${target} deployment completed.`,
      );
    } catch (error) {
      emitCommandError("firebase:deploy", error);
    }
  });

firebaseCommand
  .command("emulators")
  .description("Start Firebase emulators")
  .option("--project <id>", "Firebase project ID")
  .option("--cwd <path>", "Working directory", ".")
  .option("--config <path>", "Path to firebase.json")
  .option("--only <targets>", "Start only selected emulators")
  .option("--output <format>", "Output format: human or json", "human")
  .option("--dry-run", "Show emulator plan without executing")
  .action(async (opts) => {
    setOutputFormat(normalizeOutputFormat(opts.output));

    try {
      const projectId = await resolveProjectId(opts.project as string | undefined);
      const dryRun = !!opts.dryRun;
      const cwd = path.resolve(opts.cwd as string);

      printPlan("Firebase Emulator Plan", {
        project: projectId,
        cwd,
        dryRun,
        config: (opts.config as string | undefined) ?? "(default)",
        only: (opts.only as string | undefined) ?? "(all emulators)",
      });

      const config: ConnectorConfig = { project: { projectId } };
      const result = await firebaseConnector.execute(
        "emulators.start",
        {
          cwd,
          configPath: opts.config as string | undefined,
          dryRun,
          only: opts.only as string | undefined,
        },
        config,
      );

      emitConnectorResult(
        "firebase:emulators",
        result,
        dryRun
          ? "Firebase emulator plan ready."
          : "Firebase emulators completed.",
      );
    } catch (error) {
      emitCommandError("firebase:emulators", error);
    }
  });

function normalizeOutputFormat(value: unknown): OutputFormat {
  return value === "json" ? "json" : "human";
}

async function resolveProjectId(explicitProjectId?: string): Promise<string> {
  const manager = new AuthManager();
  const status = await manager.status();

  if (!status.projectId || !status.gcp) {
    throw new AuthError("Not authenticated. Run 'omg setup' first.");
  }

  return explicitProjectId ?? status.projectId;
}

function resolveDeployTarget(target: string | undefined): "hosting" | "functions" {
  if (target === "hosting" || target === "functions" || target === undefined) {
    return target ?? "hosting";
  }

  throw new ValidationError(
    `Unsupported Firebase deploy target: ${target}. Use 'hosting' or 'functions'.`,
  );
}

function printPlan(title: string, rows: Record<string, unknown>) {
  if (getOutputFormat() !== "human") {
    return;
  }

  console.log(`${title}:`);
  for (const [key, value] of Object.entries(rows)) {
    console.log(`  ${key}: ${String(value)}`);
  }
  console.log("");
}

async function confirm(prompt: string): Promise<boolean> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(prompt, resolve);
  });

  rl.close();
  return answer.trim().toLowerCase() === "y";
}

function emitConnectorResult(
  command: string,
  result: ConnectorResult<FirebaseCommandResult>,
  message: string,
) {
  if (!result.success) {
    fail(
      command,
      result.error?.code ?? "FIREBASE_COMMAND_FAILED",
      result.error?.message ?? "Firebase command failed.",
      result.error?.recoverable ?? false,
    );
    process.exit(1);
  }

  success(command, message, result.data ? { ...result.data } : undefined);
}

function emitCommandError(command: string, error: unknown): never {
  const omgError = toOmgError(error);
  fail(
    command,
    omgError.code,
    omgError.message,
    omgError.recoverable,
  );
  process.exit(1);
}

async function assertBudgetGuard(projectId: string, label: string): Promise<void> {
  const audit = await auditBillingGuard(projectId);
  if (audit.risk === "configured") {
    return;
  }

  throw new OmgError(
    `Budget guard blocked ${label}: ${audit.recommendedAction}`,
    "BUDGET_GUARD_BLOCKED",
    true,
  );
}

function toOmgError(error: unknown): OmgError {
  if (error instanceof OmgError) {
    return error;
  }

  if (error instanceof AuthError) {
    return error;
  }

  if (error instanceof ValidationError) {
    return error;
  }

  if (error instanceof CliRunnerError) {
    return error;
  }

  if (error instanceof Error) {
    return new ValidationError(error.message);
  }

  return new ValidationError("Unknown Firebase command error.");
}

function runFirebaseCli(args: string[], cwd: string) {
  if (getOutputFormat() === "human") {
    return spawnCliSync("firebase", args, {
      cwd,
      stdio: "inherit",
      encoding: "utf-8",
    });
  }

  return spawnCliSync("firebase", args, {
    cwd,
    encoding: "utf-8",
  });
}

function extractStdout(
  run: ReturnType<typeof runFirebaseCli>,
): string | undefined {
  return cleanOutput(run.stdout);
}

function extractStderr(
  run: ReturnType<typeof runFirebaseCli>,
): string {
  return cleanOutput(run.stderr) ?? "";
}

function cleanOutput(output: string | null): string | undefined {
  const trimmed = output?.trim();
  return trimmed ? trimmed : undefined;
}
