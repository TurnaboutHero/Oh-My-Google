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

export interface GcpProject {
  projectId: string;
  name: string;
  lifecycleState?: string;
}

interface RawProject {
  projectId: string;
  name?: string;
  lifecycleState?: string;
}

export async function listProjects(): Promise<GcpProject[]> {
  const projects = await runGcloudJson<RawProject[]>(
    ["projects", "list"],
    "Failed to list GCP projects.",
  );

  return projects.map((project) => ({
    projectId: project.projectId,
    name: project.name ?? project.projectId,
    lifecycleState: project.lifecycleState,
  }));
}

export async function createProject(projectId: string, name = projectId): Promise<void> {
  if (!projectId.trim()) {
    throw new ValidationError("Project ID is required.");
  }

  await runGcloud(
    ["projects", "create", projectId, "--name", name],
    "Failed to create the GCP project.",
  );
}

export async function setActiveProject(projectId: string): Promise<void> {
  if (!projectId.trim()) {
    throw new ValidationError("Project ID is required.");
  }

  await runGcloud(
    ["config", "set", "project", projectId],
    "Failed to set the active GCP project.",
  );
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
    normalized.includes("not currently have an active account") ||
    normalized.includes("reauthentication required")
  ) {
    return new AuthError("gcloud is not authenticated.", "NO_AUTH");
  }

  if (normalized.includes("already exists")) {
    return new OmgError("The GCP project already exists.", "PROJECT_EXISTS", false);
  }

  if (normalized.includes("quota")) {
    return new QuotaError("GCP project quota exceeded.");
  }

  return new CliRunnerError(message, getExitCode(cliError), stderr);
}

function getExitCode(error: ExecFileException): number {
  return typeof error.code === "number" ? error.code : 1;
}
