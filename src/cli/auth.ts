import { select } from "@inquirer/prompts";
import { Command } from "commander";
import { AuthManager } from "../auth/auth-manager.js";
import {
  activateGcloudConfiguration,
  createGcloudConfiguration,
  getGcloudContext,
  listGcloudAuthAccounts,
  listGcloudProjects,
  runGcloudAdcLogin,
  runGcloudAuthLogin,
  setGcloudConfigurationValue,
  type GcloudContext,
} from "../auth/gcloud-context.js";
import { OmgError, ValidationError } from "../types/errors.js";
import { getOutputFormat } from "./output.js";
import { success, fail, info } from "./output.js";

export type AuthCommandOutcome =
  | { ok: true; command: string; data: GcloudContext; next: string[] }
  | {
      ok: false;
      command: string;
      error: {
        code: string;
        message: string;
        recoverable: boolean;
        data?: Record<string, unknown>;
      };
      next?: string[];
    };

export type AuthContextOutcome = Extract<AuthCommandOutcome, { ok: true }>;

export interface AuthListPayload {
  accounts: Awaited<ReturnType<typeof listGcloudAuthAccounts>>;
  configurations: GcloudContext["configurations"];
  activeConfiguration: string | null;
  gcloudAccount: string | null;
  projectId: string | null;
  adcAccount: string | null;
  accountContext: GcloudContext["accountContext"];
}

export type AuthListOutcome =
  | { ok: true; command: "auth:list"; data: AuthListPayload; next: string[] }
  | Extract<AuthCommandOutcome, { ok: false }>;

export const authCommand = new Command("auth")
  .description("Check or manage authentication");

authCommand
  .command("status")
  .description("Show basic authentication status")
  .action(async () => {
    const manager = new AuthManager();
    const status = await manager.status();

    info("auth:status", {
      projectId: status.projectId ?? "(not configured)",
      gcpAdc: status.gcp,
    });
  });

authCommand
  .command("list")
  .description("List credentialed gcloud accounts and gcloud configurations")
  .action(async () => {
    const outcome = await runAuthList();
    emitAuthListOutcome(outcome);
  });

authCommand
  .command("create")
  .description("Create a named gcloud configuration and optionally set account/project")
  .argument("<configuration>", "gcloud configuration name")
  .option("--account <email>", "Set the gcloud account for the new configuration")
  .option("--project <id>", "Set the gcloud project for the new configuration")
  .option("--login", "Run gcloud auth login for the account")
  .option("--align-adc", "Run gcloud auth application-default login after creating the configuration")
  .action(async (
    configuration: string,
    opts: { account?: string; project?: string; login?: boolean; alignAdc?: boolean },
  ) => {
    const outcome = await runAuthCreate({
      configuration,
      account: opts.account,
      projectId: opts.project,
      login: !!opts.login,
      alignAdc: !!opts.alignAdc,
      interactive: getOutputFormat() !== "json",
    });
    emitAuthOutcome(outcome);
  });

authCommand
  .command("context")
  .description("Show active gcloud configuration, project, gcloud account, and ADC account")
  .action(async () => {
    const outcome = await runAuthContext();
    emitAuthOutcome(outcome);
  });

authCommand
  .command("switch")
  .description("Activate a named gcloud configuration and show account context")
  .argument("<configuration>", "gcloud configuration name")
  .option("--align-adc", "Run gcloud auth application-default login after switching")
  .action(async (configuration: string, opts: { alignAdc?: boolean }) => {
    const outcome = await runAuthSwitch({ configuration, alignAdc: !!opts.alignAdc });
    emitAuthOutcome(outcome);
  });

authCommand
  .command("project")
  .description("Set the active project for the current gcloud configuration")
  .option("--project <id>", "Project ID to set")
  .action(async (opts: { project?: string }) => {
    const outcome = await runAuthProject({
      projectId: opts.project,
      interactive: getOutputFormat() !== "json",
    });
    emitAuthOutcome(outcome);
  });

authCommand
  .command("refresh")
  .description("Refresh authentication tokens")
  .action(async () => {
    const { execSync } = await import("node:child_process");
    try {
      execSync("gcloud auth application-default login", { stdio: "inherit" });
      success("auth:refresh", "Token refreshed.");
    } catch {
      fail("auth:refresh", "REFRESH_FAILED", "Failed to refresh token.", false, "Is gcloud CLI installed?");
      process.exit(1);
    }
  });

export async function runAuthContext(): Promise<AuthContextOutcome> {
  const context = await getGcloudContext();
  return {
    ok: true,
    command: "auth:context",
    data: context,
    next: getAuthContextNext(context),
  };
}

export async function runAuthList(): Promise<AuthListOutcome> {
  try {
    const context = await getGcloudContext();
    const accounts = await listGcloudAuthAccounts();
    return {
      ok: true,
      command: "auth:list",
      data: {
        accounts,
        configurations: context.configurations,
        activeConfiguration: context.activeConfiguration,
        gcloudAccount: context.gcloudAccount,
        projectId: context.projectId,
        adcAccount: context.adcAccount,
        accountContext: context.accountContext,
      },
      next: getAuthContextNext(context),
    };
  } catch (error) {
    const omgError = error instanceof OmgError
      ? error
      : new OmgError(
        error instanceof Error ? error.message : "Failed to list auth context.",
        "AUTH_LIST_FAILED",
        true,
      );
    return {
      ok: false,
      command: "auth:list",
      error: {
        code: omgError.code,
        message: omgError.message,
        recoverable: omgError.recoverable,
      },
    };
  }
}

export async function runAuthSwitch(input: { configuration: string; alignAdc?: boolean }): Promise<AuthCommandOutcome> {
  try {
    if (!input.configuration.trim()) {
      throw new ValidationError("Configuration name is required.");
    }
    await activateGcloudConfiguration(input.configuration);
    if (input.alignAdc) {
      await runGcloudAdcLogin();
    }
    const context = await getGcloudContext();
    return {
      ok: true,
      command: "auth:switch",
      data: context,
      next: getAuthContextNext(context),
    };
  } catch (error) {
    const omgError = error instanceof OmgError
      ? error
      : new OmgError(
        error instanceof Error ? error.message : "Failed to switch gcloud configuration.",
        "AUTH_SWITCH_FAILED",
        true,
      );
    return {
      ok: false,
      command: "auth:switch",
      error: {
        code: omgError.code,
        message: omgError.message,
        recoverable: omgError.recoverable,
      },
    };
  }
}

function emitAuthListOutcome(outcome: AuthListOutcome): void {
  if (getOutputFormat() === "json") {
    if (outcome.ok) {
      console.log(JSON.stringify({
        ok: true,
        command: outcome.command,
        data: outcome.data,
        next: outcome.next,
      }));
      return;
    }
    console.log(JSON.stringify({
      ok: false,
      command: outcome.command,
      error: outcome.error,
      next: outcome.next,
    }));
    process.exit(1);
  }

  if (!outcome.ok) {
    fail(outcome.command, outcome.error.code, outcome.error.message, outcome.error.recoverable);
    process.exit(1);
  }

  info("auth:list", {
    activeConfiguration: outcome.data.activeConfiguration ?? "(none)",
    gcloudAccount: outcome.data.gcloudAccount ?? "(none)",
    projectId: outcome.data.projectId ?? "(none)",
    adcAccount: outcome.data.adcAccount ?? "(none)",
    accountContext: outcome.data.accountContext.detail,
    accounts: outcome.data.accounts,
    configurations: outcome.data.configurations,
  });
  if (outcome.next.length > 0) {
    console.log("Next:");
    for (const step of outcome.next) {
      console.log(`- ${step}`);
    }
  }
}

export async function runAuthCreate(input: {
  configuration: string;
  account?: string;
  projectId?: string;
  login?: boolean;
  alignAdc?: boolean;
  interactive?: boolean;
}): Promise<AuthCommandOutcome> {
  try {
    const configuration = input.configuration.trim();
    if (!configuration) {
      throw new ValidationError("Configuration name is required.");
    }

    await createGcloudConfiguration(configuration);
    if (input.login) {
      await runGcloudAuthLogin(input.account);
    }

    const detectedContext = await getGcloudContext();
    const account = input.account ?? detectedContext.gcloudAccount;
    if (account) {
      await setGcloudConfigurationValue("account", account);
    }

  const projectId = input.projectId ?? await resolveProjectIdAfterLogin(
    detectedContext.projectId,
      input.interactive ?? false,
    );
    if (projectId) {
      await setGcloudConfigurationValue("project", projectId);
    }

    if (input.alignAdc) {
      await runGcloudAdcLogin();
    }

    const context = await getGcloudContext();
    return {
      ok: true,
      command: "auth:create",
      data: context,
      next: getAuthContextNext(context),
    };
  } catch (error) {
    const omgError = error instanceof OmgError
      ? error
      : new OmgError(
        error instanceof Error ? error.message : "Failed to create gcloud configuration.",
        "AUTH_CREATE_FAILED",
        true,
      );
    return {
      ok: false,
      command: "auth:create",
      error: {
        code: omgError.code,
        message: omgError.message,
        recoverable: omgError.recoverable,
      },
    };
  }
}

export async function runAuthProject(input: {
  projectId?: string;
  interactive?: boolean;
}): Promise<AuthCommandOutcome> {
  try {
    const projectResolution = await resolveProjectIdForAuthProject(input.projectId, input.interactive ?? false);
    const projectId = projectResolution.projectId;
    if (!projectId) {
      throw new OmgError(
        "Multiple projects are visible; provide --project or run interactively to choose one.",
        "PROJECT_SELECTION_REQUIRED",
        true,
      );
    }

    await setGcloudConfigurationValue("project", projectId);
    const context = await getGcloudContext();
    return {
      ok: true,
      command: "auth:project",
      data: context,
      next: getAuthContextNext(context),
    };
  } catch (error) {
    const selectionError = error as OmgError & { data?: Record<string, unknown> };
    const omgError = error instanceof OmgError
      ? error
      : new OmgError(
        error instanceof Error ? error.message : "Failed to set gcloud project.",
        "AUTH_PROJECT_FAILED",
        true,
      );
    return {
      ok: false,
      command: "auth:project",
      error: {
        code: omgError.code,
        message: omgError.message,
        recoverable: omgError.recoverable,
        data: selectionError.data,
      },
    };
  }
}

async function resolveProjectIdForAuthProject(
  explicitProjectId: string | undefined,
  interactive: boolean,
): Promise<{ projectId?: string }> {
  if (explicitProjectId) {
    return { projectId: explicitProjectId };
  }

  const projects = await listGcloudProjects();
  if (projects.length === 1) {
    return { projectId: projects[0]?.projectId };
  }
  if (interactive && projects.length > 1) {
    return {
      projectId: await select<string>({
        message: "Select the default project for this gcloud configuration",
        choices: projects.map((project) => ({
          name: `${project.projectId} (${project.name})`,
          value: project.projectId,
        })),
      }),
    };
  }

  const error = new OmgError(
    projects.length > 0
      ? "Multiple projects are visible; provide --project or run interactively to choose one."
      : "No visible projects were found for the active account.",
    "PROJECT_SELECTION_REQUIRED",
    true,
  ) as OmgError & { data?: Record<string, unknown> };
  error.data = { projects };
  throw error;
}

async function resolveProjectIdAfterLogin(
  detectedProjectId: string | null,
  interactive: boolean,
): Promise<string | undefined> {
  if (detectedProjectId && isValidProjectId(detectedProjectId)) {
    return detectedProjectId;
  }

  const projects = await listGcloudProjects();
  if (projects.length === 1) {
    return projects[0]?.projectId;
  }
  if (interactive && projects.length > 1) {
    return select<string>({
      message: "Select the default project for this gcloud configuration",
      choices: projects.map((project) => ({
        name: `${project.projectId} (${project.name})`,
        value: project.projectId,
      })),
    });
  }

  return undefined;
}

function isValidProjectId(value: string): boolean {
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value);
}

function getAuthContextNext(context: GcloudContext): string[] {
  if (context.accountContext.ok) {
    return [];
  }
  return ["gcloud auth application-default login"];
}

function emitAuthOutcome(outcome: AuthCommandOutcome): void {
  if (getOutputFormat() === "json") {
    if (outcome.ok) {
      console.log(JSON.stringify({
        ok: true,
        command: outcome.command,
        data: outcome.data,
        next: outcome.next,
      }));
      return;
    }
    console.log(JSON.stringify({
      ok: false,
      command: outcome.command,
      data: outcome.error.data,
      error: outcome.error,
      next: outcome.next,
    }));
    process.exit(1);
  }

  if (!outcome.ok) {
    fail(
      outcome.command,
      outcome.error.code,
      outcome.error.message,
      outcome.error.recoverable,
    );
    process.exit(1);
  }

  info(outcome.command, {
    activeConfiguration: outcome.data.activeConfiguration ?? "(none)",
    gcloudAccount: outcome.data.gcloudAccount ?? "(none)",
    projectId: outcome.data.projectId ?? "(none)",
    adcAccount: outcome.data.adcAccount ?? "(none)",
    accountContext: outcome.data.accountContext.detail,
    configurations: outcome.data.configurations.map((config) => ({
      name: config.name,
      active: config.isActive,
      account: config.account ?? "(none)",
      project: config.project ?? "(none)",
    })),
  });
  if (outcome.next.length > 0) {
    console.log("Next:");
    for (const step of outcome.next) {
      console.log(`- ${step}`);
    }
  }
}

authCommand
  .command("logout")
  .description("Remove stored credentials")
  .action(async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const configPath = path.join(os.homedir(), ".omg", "config.json");
    try {
      await fs.unlink(configPath);
      success("auth:logout", "Credentials removed.");
    } catch {
      success("auth:logout", "No credentials to remove.");
    }
  });
