import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExecFileException } from "node:child_process";
import { execCliFile } from "../system/cli-runner.js";
import { AuthError, CliRunnerError, OmgError, ValidationError } from "../types/errors.js";

export interface SecretMetadata {
  name: string;
  resourceName: string;
  replication?: string;
}

export interface ListSecretsInput {
  projectId: string;
  limit?: number;
}

export interface ListSecretsResult {
  projectId: string;
  secrets: SecretMetadata[];
}

export interface SetSecretInput {
  projectId: string;
  name: string;
  value?: string;
  valueFile?: string;
  dryRun?: boolean;
}

export type SetSecretResult =
  | {
      projectId: string;
      name: string;
      created: boolean;
      versionAdded: true;
    }
  | {
      projectId: string;
      name: string;
      dryRun: true;
      wouldCreateIfMissing: true;
      wouldAddVersion: true;
    };

export type SecretManagerExecutor = (
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const DEFAULT_LIMIT = 100;

export async function listSecrets(
  input: ListSecretsInput,
  executor: SecretManagerExecutor = runGcloud,
): Promise<ListSecretsResult> {
  const projectId = normalizeProjectId(input.projectId);
  const limit = normalizeLimit(input.limit);
  const { stdout } = await executor([
    "secrets",
    "list",
    `--project=${projectId}`,
    "--format=json",
    `--limit=${limit}`,
  ]);

  return {
    projectId,
    secrets: parseSecrets(stdout),
  };
}

export async function setSecret(
  input: SetSecretInput,
  executor: SecretManagerExecutor = runGcloud,
): Promise<SetSecretResult> {
  const projectId = normalizeProjectId(input.projectId);
  const name = normalizeSecretName(input.name);
  validateSecretSource(input);

  if (input.dryRun) {
    return {
      projectId,
      name,
      dryRun: true,
      wouldCreateIfMissing: true,
      wouldAddVersion: true,
    };
  }

  const exists = await secretExists(projectId, name, executor);
  const dataFile = await prepareDataFile(input);

  try {
    if (exists) {
      await executor([
        "secrets",
        "versions",
        "add",
        name,
        `--project=${projectId}`,
        `--data-file=${dataFile.path}`,
      ]);
    } else {
      await executor([
        "secrets",
        "create",
        name,
        `--project=${projectId}`,
        "--replication-policy=automatic",
        `--data-file=${dataFile.path}`,
      ]);
    }
  } catch (error) {
    throw mapGcloudError(error, `Failed to set secret ${name}.`);
  } finally {
    await dataFile.cleanup();
  }

  return {
    projectId,
    name,
    created: !exists,
    versionAdded: true,
  };
}

async function secretExists(
  projectId: string,
  name: string,
  executor: SecretManagerExecutor,
): Promise<boolean> {
  try {
    await executor([
      "secrets",
      "describe",
      name,
      `--project=${projectId}`,
      "--format=json",
    ]);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw mapGcloudError(error, `Failed to inspect secret ${name}.`);
  }
}

async function prepareDataFile(input: SetSecretInput): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  if (input.valueFile) {
    return { path: path.resolve(input.valueFile), cleanup: async () => {} };
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-secret-"));
  const filePath = path.join(dir, "value");
  await fs.writeFile(filePath, input.value ?? "", "utf-8");

  return {
    path: filePath,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

async function runGcloud(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execCliFile("gcloud", args, {
      encoding: "utf-8",
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw mapGcloudError(error, "gcloud Secret Manager command failed.");
  }
}

function parseSecrets(stdout: string): SecretMetadata[] {
  const parsed = JSON.parse(stdout || "[]") as Array<Record<string, unknown>>;
  return parsed.map((entry) => {
    const resourceName = String(entry.name ?? "");
    return {
      name: resourceName.split("/").pop() ?? resourceName,
      resourceName,
      replication: describeReplication(entry.replication),
    };
  });
}

function describeReplication(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const replication = value as Record<string, unknown>;
  if ("automatic" in replication) {
    return "automatic";
  }
  if ("userManaged" in replication) {
    return "user-managed";
  }
  return undefined;
}

function normalizeProjectId(projectId: string): string {
  const trimmed = projectId.trim();
  if (!trimmed) {
    throw new ValidationError("Project ID is required.");
  }
  return trimmed;
}

function normalizeSecretName(name: string): string {
  const trimmed = name.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new ValidationError("Secret name must contain only letters, numbers, underscores, and hyphens.");
  }
  return trimmed;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new ValidationError("Secret list limit must be an integer from 1 to 1000.");
  }
  return limit;
}

function validateSecretSource(input: SetSecretInput): void {
  const hasValue = input.value !== undefined;
  const hasValueFile = input.valueFile !== undefined;
  if (hasValue === hasValueFile) {
    throw new ValidationError("Provide exactly one of --value or --value-file.");
  }
}

function isNotFoundError(error: unknown): boolean {
  const message = getErrorText(error).toLowerCase();
  return message.includes("not_found") || message.includes("not found") || message.includes("does not exist");
}

function mapGcloudError(error: unknown, message: string): OmgError {
  if (error instanceof OmgError) {
    return error;
  }

  const normalized = getErrorText(error).toLowerCase();
  if (
    normalized.includes("not authenticated")
    || normalized.includes("application default credentials")
    || normalized.includes("no active account")
  ) {
    return new AuthError("gcloud is not authenticated.", "NO_AUTH");
  }

  const cliError = error as ExecFileException & { stderr?: string; exitCode?: number };
  return new CliRunnerError(
    message,
    typeof cliError.code === "number" ? cliError.code : cliError.exitCode ?? 1,
    getErrorText(error),
  );
}

function getErrorText(error: unknown): string {
  const cliError = error as Error & { stderr?: string };
  return `${cliError.stderr ?? cliError.message ?? ""}`.trim();
}
