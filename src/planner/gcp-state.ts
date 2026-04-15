import fs from "node:fs/promises";
import path from "node:path";
import { execFile, type ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import { listEnabledApis } from "../setup/apis.js";
import {
  AuthError,
  CliRunnerError,
  OmgError,
  QuotaError,
} from "../types/errors.js";

const execFileAsync = promisify(execFile);

export interface GcpState {
  projectId: string;
  enabledApis: string[];
  cloudRunServices: Array<{ name: string; region: string; url?: string }>;
  firebaseLinked: boolean;
  region?: string;
}

interface RawCloudRunService {
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
  };
  status?: {
    url?: string;
  };
}

interface Firebaserc {
  projects?: {
    default?: string;
  };
}

export async function fetchGcpState(projectId: string): Promise<GcpState> {
  const enabledApis = await safeListEnabledApis(projectId);
  const services = await safeListCloudRunServices(projectId);
  const region = await getConfiguredRegion();
  const firebaseLinked = await getFirebaseLinked(projectId);

  const cloudRunServices = services.map((service) => ({
    name: service.metadata?.name ?? "unknown",
    region:
      service.metadata?.labels?.["cloud.googleapis.com/location"] ??
      region ??
      "asia-northeast3",
    url: service.status?.url,
  }));

  return {
    projectId,
    enabledApis,
    cloudRunServices,
    firebaseLinked,
    region: cloudRunServices[0]?.region ?? region ?? undefined,
  };
}

async function safeListEnabledApis(projectId: string): Promise<string[]> {
  try {
    return await listEnabledApis(projectId);
  } catch {
    return [];
  }
}

async function safeListCloudRunServices(projectId: string): Promise<RawCloudRunService[]> {
  try {
    return await runGcloudJson<RawCloudRunService[]>(
      ["run", "services", "list", "--project", projectId],
      "Failed to list Cloud Run services.",
    );
  } catch {
    return [];
  }
}

async function getConfiguredRegion(): Promise<string | undefined> {
  try {
    const stdout = await runGcloud(
      ["config", "get-value", "run/region"],
      "Failed to read the configured Cloud Run region.",
    );
    const region = stdout ? (JSON.parse(stdout) as string) : "";
    return region && region !== "(unset)" ? region : undefined;
  } catch {
    return undefined;
  }
}

async function getFirebaseLinked(projectId: string): Promise<boolean> {
  const firebasercPath = path.join(process.cwd(), ".firebaserc");
  const firebaseJsonPath = path.join(process.cwd(), "firebase.json");

  try {
    const raw = await fs.readFile(firebasercPath, "utf-8");
    const config = JSON.parse(raw) as Firebaserc;
    if (config.projects?.default === projectId) {
      return true;
    }
  } catch {
    // Ignore missing or malformed .firebaserc and fall back to firebase.json presence.
  }

  try {
    await fs.access(firebaseJsonPath);
    return true;
  } catch {
    return false;
  }
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
    normalized.includes("no active account")
  ) {
    return new AuthError("gcloud is not authenticated.", "NO_AUTH");
  }

  if (normalized.includes("quota")) {
    return new QuotaError("Google Cloud quota exceeded.");
  }

  return new CliRunnerError(message, getExitCode(cliError), stderr);
}

function getExitCode(error: ExecFileException): number {
  return typeof error.code === "number" ? error.code : 1;
}
