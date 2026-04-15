import { execFile, type ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import { confirm, input, select } from "@inquirer/prompts";
import { Command } from "commander";
import { AuthManager } from "../../auth/auth-manager.js";
import { DEFAULT_APIS, enableApis } from "../../setup/apis.js";
import { getBillingStatus, linkBilling, listBillingAccounts } from "../../setup/billing.js";
import { applyBindings, proposeDefaultRoles } from "../../setup/iam.js";
import { createProject, listProjects, setActiveProject } from "../../setup/project.js";
import { generateDefaultProfile, saveProfile } from "../../trust/profile.js";
import {
  AuthError,
  CliRunnerError,
  OmgError,
  ValidationError,
} from "../../types/errors.js";
import type { Environment } from "../../types/trust.js";
import { fail, getOutputFormat, success } from "../output.js";

const execFileAsync = promisify(execFile);

export const initCommand = new Command("init")
  .description("Initialize GCP project, billing, APIs, IAM, and trust profile")
  .option("--project <id>", "GCP project ID")
  .option("--billing <accountId>", "Billing account ID")
  .option("--environment <environment>", "Target environment: local, dev, staging, prod")
  .option("--region <region>", "Primary deployment region")
  .option("-y, --yes", "Skip confirmation prompts")
  .action(async (opts) => {
    const jsonMode = getOutputFormat() === "json";

    try {
      assertJsonFlags(
        {
          project: opts.project as string | undefined,
          billing: opts.billing as string | undefined,
          environment: opts.environment as string | undefined,
          region: opts.region as string | undefined,
          yes: !!opts.yes,
        },
        jsonMode,
      );

      await ensureGcloudInstalled();

      const manager = new AuthManager();
      const status = await manager.status();
      if (!status.gcp) {
        throw new AuthError(
          "Not authenticated. Run 'gcloud auth application-default login' first.",
          "NO_AUTH",
        );
      }

      const environment = await resolveEnvironment(
        opts.environment as string | undefined,
        jsonMode,
      );
      const region = await resolveRegion(opts.region as string | undefined, jsonMode);
      const existingProjects = await listProjects();
      const projectSelection = await resolveProjectSelection(
        opts.project as string | undefined,
        existingProjects,
        jsonMode,
      );

      if (projectSelection.create) {
        await createProject(projectSelection.projectId, projectSelection.projectName);
      }
      await setActiveProject(projectSelection.projectId);

      const billingAccountId = await resolveBillingAccount(
        opts.billing as string | undefined,
        jsonMode,
      );
      const billingStatus = await getBillingStatus(projectSelection.projectId);
      if (!billingStatus.linked || billingStatus.billingAccountId !== billingAccountId) {
        await linkBilling(projectSelection.projectId, billingAccountId);
      }

      if (!jsonMode && !opts.yes) {
        const proceed = await confirm({
          message: `Enable APIs and IAM bindings for ${projectSelection.projectId}?`,
          default: true,
        });
        if (!proceed) {
          fail("init", "CANCELLED", "Initialization cancelled by user.", false);
          return;
        }
      }

      await enableApis(projectSelection.projectId, DEFAULT_APIS);
      const iamRoles = await proposeDefaultRoles(projectSelection.projectId);
      await applyBindings(projectSelection.projectId, iamRoles);

      const trustProfile = generateDefaultProfile(projectSelection.projectId, environment);
      trustProfile.allowedRegions = [region];
      trustProfile.updatedAt = new Date().toISOString();
      await saveProfile(process.cwd(), trustProfile);

      const accountEmail = await getActiveAccount();
      await AuthManager.saveConfig({
        profile: {
          projectId: projectSelection.projectId,
          defaultRegion: region,
          accountEmail,
        },
      });

      success(
        "init",
        `Initialized project ${projectSelection.projectId}.`,
        {
          projectId: projectSelection.projectId,
          enabledApis: DEFAULT_APIS,
          iamRoles,
          trustProfile,
        },
        ["omg link"],
      );
    } catch (error) {
      emitInitError(error);
    }
  });

function assertJsonFlags(
  opts: {
    project?: string;
    billing?: string;
    environment?: string;
    region?: string;
    yes: boolean;
  },
  jsonMode: boolean,
) {
  if (!jsonMode) {
    return;
  }

  if (!opts.project || !opts.billing || !opts.environment || !opts.region || !opts.yes) {
    throw new ValidationError(
      "JSON mode requires --project, --billing, --environment, --region, and --yes.",
    );
  }
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
    await execFileAsync("gcloud", ["--version"], {
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
    const { stdout } = await execFileAsync(
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

function emitInitError(error: unknown): never {
  const omgError =
    error instanceof OmgError
      ? error
      : new ValidationError(error instanceof Error ? error.message : "Unknown init error.");

  fail(
    "init",
    omgError.code,
    omgError.message,
    omgError.recoverable,
    omgError.code === "VALIDATION_ERROR"
      ? "Provide --project, --billing, --environment, --region, and --yes in JSON mode."
      : undefined,
  );
  process.exit(1);
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
