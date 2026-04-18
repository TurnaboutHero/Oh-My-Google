import type { ExecFileException } from "node:child_process";
import { execCliFile } from "../system/cli-runner.js";
import {
  AuthError,
  CliRunnerError,
  OmgError,
  QuotaError,
  ValidationError,
} from "../types/errors.js";

export const DEFAULT_APIS = [
  "cloudbuild.googleapis.com",
  "run.googleapis.com",
  "artifactregistry.googleapis.com",
  "firebasehosting.googleapis.com",
  "firestore.googleapis.com",
  "secretmanager.googleapis.com",
  "iam.googleapis.com",
  "serviceusage.googleapis.com",
];

interface RawService {
  config?: {
    name?: string;
  };
}

export async function enableApis(projectId: string, apiNames: string[]): Promise<void> {
  if (!projectId.trim()) {
    throw new ValidationError("Project ID is required.");
  }

  if (apiNames.length === 0) {
    return;
  }

  await runGcloud(
    ["services", "enable", ...apiNames, "--project", projectId],
    "Failed to enable the required APIs.",
  );
}

export async function listEnabledApis(projectId: string): Promise<string[]> {
  if (!projectId.trim()) {
    throw new ValidationError("Project ID is required.");
  }

  const services = await runGcloudJson<RawService[]>(
    ["services", "list", "--enabled", "--project", projectId],
    "Failed to list enabled APIs.",
  );

  return services
    .map((service) => service.config?.name)
    .filter((name): name is string => typeof name === "string");
}

async function runGcloudJson<T>(
  args: string[],
  message: string,
): Promise<T> {
  const stdout = await runGcloud(args, message);
  return (stdout ? JSON.parse(stdout) : []) as T;
}

async function runGcloud(args: string[], message: string): Promise<string> {
  try {
    const { stdout } = await execCliFile("gcloud", [...args, "--format=json"], {
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
    return new OmgError("Billing must be enabled before APIs can be enabled.", "NO_BILLING", false);
  }

  if (normalized.includes("quota")) {
    return new QuotaError("Service Usage quota exceeded.");
  }

  return new CliRunnerError(message, getExitCode(cliError), stderr);
}

function getExitCode(error: ExecFileException): number {
  return typeof error.code === "number" ? error.code : 1;
}
