import { execFile, type ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import { AuthError, CliRunnerError, OmgError, ValidationError } from "../types/errors.js";

const execFileAsync = promisify(execFile);
const SECRET_PATTERN = /^\$\{SECRET:([^}]+)\}$/;

export async function resolveEnv(
  env: Record<string, string>,
  projectId: string,
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    const match = value.match(SECRET_PATTERN);
    if (!match) {
      resolved[key] = value;
      continue;
    }

    resolved[key] = await accessSecret(projectId, match[1]);
  }

  return resolved;
}

async function accessSecret(projectId: string, secretName: string): Promise<string> {
  if (!projectId.trim() || !secretName.trim()) {
    throw new ValidationError("Project ID and secret name are required.");
  }

  try {
    const { stdout } = await execFileAsync(
      "gcloud",
      [
        "secrets",
        "versions",
        "access",
        "latest",
        `--secret=${secretName}`,
        `--project=${projectId}`,
      ],
      {
        encoding: "utf-8",
        windowsHide: true,
      },
    );
    return stdout.trim();
  } catch (error) {
    throw mapGcloudError(error, secretName);
  }
}

function mapGcloudError(error: unknown, secretName: string): OmgError {
  const cliError = error as ExecFileException & { stderr?: string };
  const stderr = `${cliError.stderr ?? cliError.message ?? ""}`.trim();
  const normalized = stderr.toLowerCase();

  if (
    normalized.includes("not authenticated")
    || normalized.includes("application default credentials")
    || normalized.includes("no active account")
  ) {
    return new AuthError("gcloud is not authenticated.", "NO_AUTH");
  }

  return new CliRunnerError(
    `Failed to resolve secret ${secretName}.`,
    typeof cliError.code === "number" ? cliError.code : 1,
    stderr,
  );
}
