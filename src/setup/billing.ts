import { execFile, type ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import {
  AuthError,
  CliRunnerError,
  OmgError,
  QuotaError,
  ValidationError,
} from "../types/errors.js";

const execFileAsync = promisify(execFile);

export interface BillingAccount {
  id: string;
  displayName: string;
  open: boolean;
}

interface RawBillingAccount {
  name: string;
  displayName?: string;
  open?: boolean;
}

interface RawBillingProject {
  billingAccountName?: string;
  billingEnabled?: boolean;
}

export async function listBillingAccounts(): Promise<BillingAccount[]> {
  const accounts = await runGcloudJson<RawBillingAccount[]>(
    ["billing", "accounts", "list"],
    "Failed to list billing accounts.",
  );

  return accounts.map((account) => ({
    id: stripBillingAccountPrefix(account.name),
    displayName: account.displayName ?? stripBillingAccountPrefix(account.name),
    open: account.open !== false,
  }));
}

export async function linkBilling(projectId: string, billingAccountId: string): Promise<void> {
  if (!projectId.trim() || !billingAccountId.trim()) {
    throw new ValidationError("Project ID and billing account ID are required.");
  }

  await runGcloud(
    [
      "billing",
      "projects",
      "link",
      projectId,
      "--billing-account",
      billingAccountId,
    ],
    "Failed to link the billing account to the project.",
  );
}

export async function getBillingStatus(
  projectId: string,
): Promise<{ linked: boolean; billingAccountId?: string }> {
  if (!projectId.trim()) {
    throw new ValidationError("Project ID is required.");
  }

  try {
    const result = await runGcloudJson<RawBillingProject>(
      ["billing", "projects", "describe", projectId],
      "Failed to read billing status for the project.",
    );

    return {
      linked: result.billingEnabled === true,
      billingAccountId: result.billingAccountName
        ? stripBillingAccountPrefix(result.billingAccountName)
        : undefined,
    };
  } catch (error) {
    if (error instanceof OmgError && error.code === "NO_BILLING") {
      return { linked: false };
    }
    throw error;
  }
}

async function runGcloudJson<T>(
  args: string[],
  message: string,
): Promise<T> {
  const stdout = await runGcloud(args, message);
  return (stdout ? JSON.parse(stdout) : {}) as T;
}

async function runGcloud(args: string[], message: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gcloud", [...args, "--format=json"], {
      encoding: "utf-8",
      windowsHide: true,
    });
    return stdout.trim();
  } catch (error) {
    throw mapGcloudError(error, message);
  }
}

function mapGcloudError(error: unknown, message: string): OmgError {
  const cliError = error as ExecFileException & { stderr?: string };
  const stderr = `${cliError.stderr ?? cliError.message ?? ""}`.trim();
  const normalized = stderr.toLowerCase();

  if (cliError.code === "ENOENT") {
    return new CliRunnerError("gcloud CLI is not installed.", 1, stderr);
  }

  if (
    normalized.includes("not authenticated") ||
    normalized.includes("application default credentials") ||
    normalized.includes("no active account") ||
    normalized.includes("not currently have an active account")
  ) {
    return new AuthError("gcloud is not authenticated.", "NO_AUTH");
  }

  if (normalized.includes("billing")) {
    return new OmgError("A billing account is required for this operation.", "NO_BILLING", false);
  }

  if (normalized.includes("quota")) {
    return new QuotaError("Billing quota exceeded.");
  }

  return new CliRunnerError(message, getExitCode(cliError), stderr);
}

function stripBillingAccountPrefix(value: string): string {
  return value.replace(/^billingAccounts\//, "");
}

function getExitCode(error: ExecFileException): number {
  return typeof error.code === "number" ? error.code : 1;
}
