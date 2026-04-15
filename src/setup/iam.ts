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

export interface ProposedBinding {
  principal: string;
  role: string;
  reason: string;
}

const DEFAULT_ROLE_REASONS = [
  {
    role: "roles/run.admin",
    reason: "Allows Cloud Run deployments during omg init and omg deploy.",
  },
  {
    role: "roles/firebasehosting.admin",
    reason: "Allows Firebase Hosting rewrites and frontend deployments.",
  },
  {
    role: "roles/iam.serviceAccountUser",
    reason: "Allows deployments to act as the default runtime service account.",
  },
  {
    role: "roles/serviceusage.serviceUsageAdmin",
    reason: "Allows enabling the required Google APIs for the project.",
  },
];

export async function proposeDefaultRoles(projectId: string): Promise<ProposedBinding[]> {
  if (!projectId.trim()) {
    throw new ValidationError("Project ID is required.");
  }

  const activeAccount = await getActiveAccount();
  const principal = `user:${activeAccount}`;

  return DEFAULT_ROLE_REASONS.map(({ role, reason }) => ({
    principal,
    role,
    reason,
  }));
}

export async function applyBindings(projectId: string, bindings: ProposedBinding[]): Promise<void> {
  if (!projectId.trim()) {
    throw new ValidationError("Project ID is required.");
  }

  for (const binding of bindings) {
    await runGcloud(
      [
        "projects",
        "add-iam-policy-binding",
        projectId,
        "--member",
        binding.principal,
        "--role",
        binding.role,
      ],
      `Failed to apply IAM binding ${binding.role}.`,
    );
  }
}

async function getActiveAccount(): Promise<string> {
  const stdout = await runGcloud(
    ["config", "get-value", "account"],
    "Failed to read the active gcloud account.",
  );
  const account = stdout ? (JSON.parse(stdout) as string) : "";
  if (!account || account === "(unset)") {
    throw new AuthError("gcloud does not have an active account configured.", "NO_AUTH");
  }
  return account;
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

  if (normalized.includes("quota")) {
    return new QuotaError("IAM quota exceeded.");
  }

  return new CliRunnerError(message, getExitCode(cliError), stderr);
}

function getExitCode(error: ExecFileException): number {
  return typeof error.code === "number" ? error.code : 1;
}
