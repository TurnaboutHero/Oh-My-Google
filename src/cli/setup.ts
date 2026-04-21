import { confirm } from "@inquirer/prompts";
import { Command } from "commander";
import { AuthManager } from "../auth/auth-manager.js";
import {
  activateGcloudConfiguration,
  getGcloudContext,
  type GcloudContext,
} from "../auth/gcloud-context.js";
import { execCliFile } from "../system/cli-runner.js";
import { OmgError, ValidationError } from "../types/errors.js";
import { runDoctor, type DoctorResult } from "./doctor.js";
import { fail, getOutputFormat, success } from "./output.js";

export interface RunSetupInput {
  cwd: string;
  projectId?: string;
  configuration?: string;
  login?: boolean;
  alignAdc?: boolean;
  interactive?: boolean;
  yes?: boolean;
}

export interface SetupPayload {
  projectId: string;
  gcloudInstalled: boolean;
  firebaseInstalled: boolean;
  authContext: GcloudContext;
  doctor: DoctorResult;
}

export type RunSetupOutcome =
  | { ok: true; data: SetupPayload; next: string[] }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        recoverable: boolean;
        hint?: string;
        data?: Record<string, unknown>;
        next?: string[];
      };
    };

export const setupCommand = new Command("setup")
  .description("Configure local Google tooling, account context, project config, and doctor checks")
  .option("--project-id <id>", "GCP project ID")
  .option("--configuration <name>", "Activate a named gcloud configuration before setup")
  .option("--login", "Run gcloud auth login when no active gcloud account is present")
  .option("--align-adc", "Run gcloud auth application-default login to align ADC with the active account")
  .option("-y, --yes", "Approve setup prompts in interactive mode")
  .action(async (opts) => {
    const jsonMode = getOutputFormat() === "json";
    const outcome = await runSetup({
      cwd: process.cwd(),
      projectId: opts.projectId as string | undefined,
      configuration: opts.configuration as string | undefined,
      login: !!opts.login,
      alignAdc: !!opts.alignAdc,
      interactive: !jsonMode,
      yes: !!opts.yes,
    });

    if (outcome.ok) {
      success("setup", `Project ${outcome.data.projectId} configured.`, {
        projectId: outcome.data.projectId,
        gcloudInstalled: outcome.data.gcloudInstalled,
        firebaseInstalled: outcome.data.firebaseInstalled,
        authContext: outcome.data.authContext,
        doctor: outcome.data.doctor,
      }, outcome.next);
      return;
    }

    fail(
      "setup",
      outcome.error.code,
      outcome.error.message,
      outcome.error.recoverable,
      outcome.error.hint,
      outcome.error.data,
      outcome.error.next,
    );
    process.exit(1);
  });

export async function runSetup(input: RunSetupInput): Promise<RunSetupOutcome> {
  try {
    const gcloudInstalled = await checkCli("gcloud");
    if (!gcloudInstalled) {
      return {
        ok: false,
        error: {
          code: "GCLOUD_NOT_FOUND",
          message: "gcloud CLI is not installed or not on PATH.",
          recoverable: true,
          hint: "Install Google Cloud SDK, then rerun omg setup.",
          next: ["install Google Cloud SDK"],
        },
      };
    }

    const firebaseInstalled = await checkCli("firebase");

    if (input.configuration) {
      await activateGcloudConfiguration(input.configuration);
    }

    let authContext = await getGcloudContext();
    if (!authContext.gcloudAccount) {
      const shouldLogin = input.login || await shouldRunInteractiveStep(
        input,
        "No active gcloud account found. Run gcloud auth login now?",
      );
      if (!shouldLogin) {
        return {
          ok: false,
          error: {
            code: "NO_AUTH",
            message: "No active gcloud account.",
            recoverable: true,
            hint: "Run gcloud auth login or rerun setup with --login.",
            next: ["gcloud auth login"],
          },
        };
      }
      await runGcloudAuthLogin();
      authContext = await getGcloudContext();
    }

    if (!authContext.accountContext.ok) {
      const shouldAlignAdc = input.alignAdc || await shouldRunInteractiveStep(
        input,
        `${authContext.accountContext.detail}. Run gcloud auth application-default login now?`,
      );
      if (shouldAlignAdc) {
        await runGcloudAdcLogin();
        authContext = await getGcloudContext();
      }
    }

    const projectId = input.projectId ?? authContext.projectId;
    if (!projectId) {
      return {
        ok: false,
        error: {
          code: "NO_PROJECT",
          message: "No project ID provided or configured in gcloud.",
          recoverable: true,
          hint: "Use --project-id or run gcloud config set project <id>.",
          next: ["gcloud config set project <project-id>"],
        },
      };
    }

    await AuthManager.saveConfig({
      profile: {
        projectId,
        accountEmail: authContext.gcloudAccount ?? undefined,
      },
    });

    const doctor = await runDoctor(input.cwd);
    return {
      ok: true,
      data: {
        projectId,
        gcloudInstalled,
        firebaseInstalled,
        authContext,
        doctor,
      },
      next: getSetupNext(firebaseInstalled, doctor),
    };
  } catch (error) {
    const omgError = error instanceof OmgError
      ? error
      : new ValidationError(error instanceof Error ? error.message : "Unknown setup error.");
    return {
      ok: false,
      error: {
        code: omgError.code,
        message: omgError.message,
        recoverable: omgError.recoverable,
      },
    };
  }
}

async function checkCli(command: "gcloud" | "firebase"): Promise<boolean> {
  try {
    await execCliFile(command, ["--version"], {
      encoding: "utf-8",
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function shouldRunInteractiveStep(input: RunSetupInput, message: string): Promise<boolean> {
  if (input.yes) {
    return true;
  }
  if (input.interactive) {
    return confirm({ message, default: false });
  }
  return false;
}

async function runGcloudAuthLogin(): Promise<void> {
  await execCliFile("gcloud", ["auth", "login"], {
    encoding: "utf-8",
    windowsHide: false,
    maxBuffer: 1024 * 1024 * 10,
  });
}

async function runGcloudAdcLogin(): Promise<void> {
  await execCliFile("gcloud", ["auth", "application-default", "login"], {
    encoding: "utf-8",
    windowsHide: false,
    maxBuffer: 1024 * 1024 * 10,
  });
}

function getSetupNext(firebaseInstalled: boolean, doctor: DoctorResult): string[] {
  const next = [...doctor.next];
  if (!firebaseInstalled) {
    next.unshift("install Firebase CLI: npm install -g firebase-tools");
  }
  next.push("omg link");
  return [...new Set(next)];
}
