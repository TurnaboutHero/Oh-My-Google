import type { ExecFileException } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { confirm, input, select } from "@inquirer/prompts";
import { Command } from "commander";
import { AuthManager } from "../../auth/auth-manager.js";
import { createRunId, tryAppendDecision } from "../../harness/decision-log.js";
import { DEFAULT_APIS, enableApis } from "../../setup/apis.js";
import { getBillingStatus, linkBilling, listBillingAccounts } from "../../setup/billing.js";
import { applyBindings, proposeDefaultRoles } from "../../setup/iam.js";
import { createProject, listProjects, setActiveProject } from "../../setup/project.js";
import { execCliFile } from "../../system/cli-runner.js";
import { generateDefaultProfile, saveProfile } from "../../trust/profile.js";
import {
  AuthError,
  CliRunnerError,
  OmgError,
  ValidationError,
} from "../../types/errors.js";
import type { Environment } from "../../types/trust.js";
import { fail, getOutputFormat, success } from "../output.js";

export interface RunInitInput {
  cwd: string;
  projectId?: string;
  billingAccount?: string;
  environment?: "local" | "dev" | "staging" | "prod";
  region?: string;
  jsonMode?: boolean;
  interactive?: boolean;
  yes?: boolean;
}

export interface InitPayload {
  projectId: string;
  environment: string;
  region: string;
  trustProfilePath: string;
  configPath: string;
}

export interface InitErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
  hint?: string;
  data?: Record<string, unknown>;
}

export type RunInitOutcome =
  | { ok: true; data: InitPayload; next?: string[] }
  | { ok: false; error: InitErrorPayload };

export const initCommand = new Command("init")
  .description("Initialize GCP project, billing, APIs, IAM, and trust profile")
  .option("--project <id>", "GCP project ID")
  .option("--billing <accountId>", "Billing account ID")
  .option("--environment <environment>", "Target environment: local, dev, staging, prod")
  .option("--region <region>", "Primary deployment region")
  .option("-y, --yes", "Skip confirmation prompts")
  .action(async (opts) => {
    const jsonMode = getOutputFormat() === "json";
    const outcome = await runInit({
      cwd: process.cwd(),
      projectId: opts.project as string | undefined,
      billingAccount: opts.billing as string | undefined,
      environment: opts.environment as RunInitInput["environment"] | undefined,
      region: opts.region as string | undefined,
      jsonMode,
      interactive: jsonMode ? undefined : true,
      yes: !!opts.yes,
    });

    if (outcome.ok) {
      success(
        "init",
        `Initialized project ${outcome.data.projectId}.`,
        { ...outcome.data },
        outcome.next,
      );
      return;
    }

    fail(
      "init",
      outcome.error.code,
      outcome.error.message,
      outcome.error.recoverable,
      outcome.error.hint,
      outcome.error.data,
    );
    process.exit(1);
  });

export async function runInit(input: RunInitInput): Promise<RunInitOutcome> {
  const runId = createRunId("init");
  try {
    const structuredMode = input.jsonMode || input.interactive === false;
    const missing = getMissingRequiredInitFields(input);
    if (input.jsonMode && input.interactive !== false && !input.yes) {
      missing.push("yes");
    }
    if (structuredMode && missing.length > 0) {
      const cliJsonMissingYes = missing.includes("yes");
      const outcome: RunInitOutcome = {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: cliJsonMissingYes
            ? "JSON mode requires --project, --billing, --environment, --region, and --yes."
            : "Initialization requires projectId, billingAccount, environment, and region.",
          recoverable: true,
          hint: cliJsonMissingYes
            ? "Provide --project, --billing, --environment, --region, and --yes in JSON mode."
            : "Provide projectId, billingAccount, environment, and region.",
          data: { missing },
        },
      };
      await tryAppendDecision(input.cwd, {
        runId,
        command: "init",
        phase: "validate",
        status: "failure",
        result: outcome.error,
      });
      return outcome;
    }

    await ensureGcloudInstalled();

    const manager = new AuthManager();
    const status = await manager.status();
    if (!status.gcp) {
      throw new AuthError(
        "Not authenticated. Run 'gcloud auth application-default login' first.",
        "NO_AUTH",
      );
    }

    const environment = await resolveEnvironment(input.environment, structuredMode);
    const region = await resolveRegion(input.region, structuredMode);
    const existingProjects = await listProjects();
    const projectSelection = await resolveProjectSelection(
      input.projectId,
      existingProjects,
      structuredMode,
    );

    if (projectSelection.create) {
      await createProject(projectSelection.projectId, projectSelection.projectName);
    }
    await setActiveProject(projectSelection.projectId);

    const billingAccountId = await resolveBillingAccount(
      input.billingAccount,
      structuredMode,
    );
    const billingStatus = await getBillingStatus(projectSelection.projectId);
    if (!billingStatus.linked || billingStatus.billingAccountId !== billingAccountId) {
      await linkBilling(projectSelection.projectId, billingAccountId);
    }

    if (!structuredMode && !input.yes) {
      const proceed = await confirm({
        message: `Enable APIs and IAM bindings for ${projectSelection.projectId}?`,
        default: true,
      });
      if (!proceed) {
        const outcome: RunInitOutcome = {
          ok: false,
          error: {
            code: "CANCELLED",
            message: "Initialization cancelled by user.",
            recoverable: false,
          },
        };
        await tryAppendDecision(input.cwd, {
          runId,
          command: "init",
          phase: "confirm",
          status: "blocked",
          projectId: projectSelection.projectId,
          environment,
          result: outcome.error,
        });
        return outcome;
      }
    }

    await enableApis(projectSelection.projectId, DEFAULT_APIS);
    const iamRoles = await proposeDefaultRoles(projectSelection.projectId);
    await applyBindings(projectSelection.projectId, iamRoles);

    const trustProfile = generateDefaultProfile(projectSelection.projectId, environment);
    trustProfile.allowedRegions = [region];
    trustProfile.updatedAt = new Date().toISOString();
    await saveProfile(input.cwd, trustProfile);

    const accountEmail = await getActiveAccount();
    await AuthManager.saveConfig({
      profile: {
        projectId: projectSelection.projectId,
        defaultRegion: region,
        accountEmail,
      },
    });

    const outcome: RunInitOutcome = {
      ok: true,
      data: {
        projectId: projectSelection.projectId,
        environment,
        region,
        trustProfilePath: path.join(input.cwd, ".omg", "trust.yaml"),
        configPath: path.join(os.homedir(), ".omg", "config.json"),
      },
      next: ["omg link"],
    };
    await tryAppendDecision(input.cwd, {
      runId,
      command: "init",
      phase: "execute",
      status: "success",
      projectId: projectSelection.projectId,
      environment,
      result: {
        region,
        trustProfilePath: outcome.data.trustProfilePath,
        configPath: outcome.data.configPath,
      },
      next: outcome.next,
    });
    return outcome;
  } catch (error) {
    const omgError =
      error instanceof OmgError
        ? error
        : new ValidationError(error instanceof Error ? error.message : "Unknown init error.");

    const outcome: RunInitOutcome = {
      ok: false,
      error: {
        code: omgError.code,
        message: omgError.message,
        recoverable: omgError.recoverable,
        hint:
          omgError.code === "VALIDATION_ERROR"
            ? "Provide projectId, billingAccount, environment, and region."
            : undefined,
      },
    };
    await tryAppendDecision(input.cwd, {
      runId,
      command: "init",
      phase: "execute",
      status: "failure",
      result: outcome.error,
      next: outcome.error.hint ? [outcome.error.hint] : undefined,
    });
    return outcome;
  }
}

function getMissingRequiredInitFields(input: RunInitInput): string[] {
  const missing: string[] = [];
  if (!input.projectId) {
    missing.push("projectId");
  }
  if (!input.billingAccount) {
    missing.push("billingAccount");
  }
  if (!input.environment) {
    missing.push("environment");
  }
  if (!input.region) {
    missing.push("region");
  }
  return missing;
}

async function resolveEnvironment(
  value: string | undefined,
  jsonMode: boolean,
): Promise<Environment> {
  if (value) {
    return validateEnvironment(value);
  }

  if (jsonMode) {
    throw new ValidationError(
      "JSON mode requires --project, --billing, --environment, --region, and --yes.",
    );
  }

  return select<Environment>({
    message: "Select the target environment",
    choices: [
      { name: "local", value: "local" },
      { name: "dev", value: "dev" },
      { name: "staging", value: "staging" },
      { name: "prod", value: "prod" },
    ],
    default: "dev",
  });
}

async function resolveRegion(value: string | undefined, jsonMode: boolean): Promise<string> {
  if (value) {
    return value;
  }

  if (jsonMode) {
    throw new ValidationError(
      "JSON mode requires --project, --billing, --environment, --region, and --yes.",
    );
  }

  return input({
    message: "Primary deployment region",
    default: "asia-northeast3",
    validate: (answer) => (answer ? true : "Region is required."),
  });
}

async function resolveProjectSelection(
  explicitProjectId: string | undefined,
  existingProjects: Array<{ projectId: string; name: string }>,
  jsonMode: boolean,
): Promise<{ projectId: string; projectName: string; create: boolean }> {
  if (explicitProjectId) {
    const existing = existingProjects.find((project) => project.projectId === explicitProjectId);
    return {
      projectId: explicitProjectId,
      projectName: existing?.name ?? explicitProjectId,
      create: !existing,
    };
  }

  if (jsonMode) {
    throw new ValidationError(
      "JSON mode requires --project, --billing, --environment, --region, and --yes.",
    );
  }

  const selected = await select<string>({
    message: "Select a GCP project",
    choices: [
      ...existingProjects.map((project) => ({
        name: `${project.projectId} (${project.name})`,
        value: project.projectId,
      })),
      {
        name: "Create a new project",
        value: "__create__",
      },
    ],
  });

  if (selected !== "__create__") {
    const existing = existingProjects.find((project) => project.projectId === selected);
    return {
      projectId: existing?.projectId ?? selected,
      projectName: existing?.name ?? selected,
      create: false,
    };
  }

  const projectId = await input({
    message: "New project ID",
    validate: (answer) => (answer ? true : "Project ID is required."),
  });
  const projectName = await input({
    message: "Project display name",
    default: projectId,
  });

  return {
    projectId,
    projectName,
    create: true,
  };
}

async function resolveBillingAccount(
  explicitBillingId: string | undefined,
  jsonMode: boolean,
): Promise<string> {
  if (explicitBillingId) {
    return explicitBillingId;
  }

  if (jsonMode) {
    throw new ValidationError(
      "JSON mode requires --project, --billing, --environment, --region, and --yes.",
    );
  }

  const billingAccounts = (await listBillingAccounts()).filter((account) => account.open);
  if (billingAccounts.length === 0) {
    throw new OmgError("No open billing accounts available.", "NO_BILLING", false);
  }

  return select<string>({
    message: "Select a billing account",
    choices: billingAccounts.map((account) => ({
      name: `${account.id} (${account.displayName})`,
      value: account.id,
    })),
  });
}

function validateEnvironment(value: string): Environment {
  if (value === "local" || value === "dev" || value === "staging" || value === "prod") {
    return value;
  }

  throw new ValidationError("Environment must be one of local, dev, staging, or prod.");
}

async function ensureGcloudInstalled(): Promise<void> {
  try {
    await execCliFile("gcloud", ["--version"], {
      encoding: "utf-8",
      windowsHide: true,
    });
  } catch (error) {
    const cliError = error as ExecFileException & { stderr?: string };
    throw new CliRunnerError(
      "gcloud CLI is not installed.",
      typeof cliError.code === "number" ? cliError.code : 1,
      `${cliError.stderr ?? cliError.message ?? ""}`.trim(),
    );
  }
}

async function getActiveAccount(): Promise<string | undefined> {
  try {
    const { stdout } = await execCliFile(
      "gcloud",
      ["config", "get-value", "account", "--format=json"],
      {
        encoding: "utf-8",
        windowsHide: true,
      },
    );
    const value = stdout.trim();
    if (!value || value === "(unset)") {
      return undefined;
    }

    try {
      const parsed = JSON.parse(value) as string;
      return parsed === "(unset)" ? undefined : parsed;
    } catch {
      return value;
    }
  } catch {
    return undefined;
  }
}

initCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg init
  omg init --project my-project --billing 000000-000000-000000 --environment dev --region asia-northeast3 --yes
  omg --output json init --project my-project --billing 000000-000000-000000 --environment dev --region asia-northeast3 --yes
`,
);
