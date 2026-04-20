import { execCliFile } from "../system/cli-runner.js";

type ExecOptions = Parameters<typeof execCliFile>[2];

export interface GcloudConfiguration {
  name: string;
  isActive: boolean;
  account: string | null;
  project: string | null;
}

export interface AccountContext {
  ok: boolean;
  detail: string;
}

export interface GcloudContext {
  activeConfiguration: string | null;
  gcloudAccount: string | null;
  projectId: string | null;
  adcAccount: string | null;
  configurations: GcloudConfiguration[];
  accountContext: AccountContext;
}

export interface GcloudProjectSummary {
  projectId: string;
  name: string;
}

export interface GcloudAuthAccount {
  email: string;
  active: boolean;
}

export async function getGcloudContext(): Promise<GcloudContext> {
  const configurations = await listGcloudConfigurations();
  const activeConfiguration = configurations.find((config) => config.isActive) ?? null;
  const gcloudAccountFromConfig = await readGcloudConfigValue("account");
  const projectIdFromConfig = await readGcloudConfigValue("project");
  const adcAccount = await readAdcAccount();
  const gcloudAccount = activeConfiguration?.account ?? gcloudAccountFromConfig;
  const projectId = activeConfiguration?.project ?? projectIdFromConfig;

  return {
    activeConfiguration: activeConfiguration?.name ?? null,
    gcloudAccount,
    projectId,
    adcAccount,
    configurations,
    accountContext: getAccountContext(gcloudAccount, adcAccount),
  };
}

export async function activateGcloudConfiguration(configuration: string): Promise<void> {
  await execGcloud(
    "gcloud",
    ["config", "configurations", "activate", configuration, "--quiet"],
    {
      encoding: "utf-8",
      windowsHide: true,
    },
  );
}

export async function createGcloudConfiguration(configuration: string): Promise<void> {
  await execGcloud(
    "gcloud",
    ["config", "configurations", "create", configuration],
    {
      encoding: "utf-8",
      windowsHide: true,
    },
  );
}

export async function setGcloudConfigurationValue(
  key: "account" | "project",
  value: string,
): Promise<void> {
  await execGcloud(
    "gcloud",
    ["config", "set", key, value],
    {
      encoding: "utf-8",
      windowsHide: true,
    },
  );
}

export async function runGcloudAuthLogin(account?: string): Promise<void> {
  await execGcloud(
    "gcloud",
    account ? ["auth", "login", account] : ["auth", "login"],
    {
      encoding: "utf-8",
      windowsHide: false,
      maxBuffer: 1024 * 1024 * 10,
    },
  );
}

export async function runGcloudAdcLogin(): Promise<void> {
  await execGcloud(
    "gcloud",
    ["auth", "application-default", "login"],
    {
      encoding: "utf-8",
      windowsHide: false,
      maxBuffer: 1024 * 1024 * 10,
    },
  );
}

export async function listGcloudProjects(): Promise<GcloudProjectSummary[]> {
  try {
    const { stdout } = await execGcloud(
      "gcloud",
      ["projects", "list", "--format=json(projectId,name)"],
      {
        encoding: "utf-8",
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 10,
      },
    );
    const rows = JSON.parse(stdout || "[]") as Array<{
      projectId?: unknown;
      name?: unknown;
    }>;
    return rows
      .map((row) => ({
        projectId: stringOrNull(row.projectId) ?? "",
        name: stringOrNull(row.name) ?? stringOrNull(row.projectId) ?? "",
      }))
      .filter((row) => row.projectId.length > 0);
  } catch {
    return [];
  }
}

export async function listGcloudAuthAccounts(): Promise<GcloudAuthAccount[]> {
  try {
    const { stdout } = await execGcloud(
      "gcloud",
      ["auth", "list", "--format=json"],
      {
        encoding: "utf-8",
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 10,
      },
    );
    const rows = JSON.parse(stdout || "[]") as Array<{
      account?: unknown;
      status?: unknown;
    }>;
    return rows
      .map((row) => ({
        email: stringOrNull(row.account) ?? "",
        active: row.status === "ACTIVE",
      }))
      .filter((row) => row.email.length > 0);
  } catch {
    return [];
  }
}

async function listGcloudConfigurations(): Promise<GcloudConfiguration[]> {
  try {
    const { stdout } = await execGcloud(
      "gcloud",
      ["config", "configurations", "list", "--format=json"],
      {
        encoding: "utf-8",
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 10,
      },
    );
    const rows = JSON.parse(stdout || "[]") as Array<{
      name?: unknown;
      is_active?: unknown;
      properties?: {
        core?: {
          account?: unknown;
          project?: unknown;
        };
      };
    }>;

    return rows
      .map((row) => ({
        name: typeof row.name === "string" ? row.name : "",
        isActive: row.is_active === true,
        account: stringOrNull(row.properties?.core?.account),
        project: stringOrNull(row.properties?.core?.project),
      }))
      .filter((row) => row.name.length > 0);
  } catch {
    return [];
  }
}

async function readGcloudConfigValue(key: "account" | "project"): Promise<string | null> {
  try {
    const { stdout } = await execGcloud(
      "gcloud",
      ["config", "get-value", key],
      {
        encoding: "utf-8",
        windowsHide: true,
      },
    );
    const value = stringOrNull(stdout.trim());
    if (key === "project" && value && !isValidProjectId(value)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

async function execGcloud(
  command: string,
  args: string[],
  options: ExecOptions,
): Promise<{ stdout: string; stderr: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await execCliFile(command, args, options);
    } catch (error) {
      lastError = error;
      await delay(100 * (attempt + 1));
    }
  }
  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readAdcAccount(): Promise<string | null> {
  try {
    const { stdout } = await execCliFile(
      "gcloud",
      [
        "auth",
        "application-default",
        "print-access-token",
        "--scopes=openid,https://www.googleapis.com/auth/userinfo.email",
      ],
      {
        encoding: "utf-8",
        windowsHide: true,
      },
    );
    const token = stdout.trim();
    if (!token) {
      return null;
    }

    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
    );
    if (!response.ok) {
      return null;
    }
    const payload = await response.json() as { email?: unknown };
    return stringOrNull(payload.email);
  } catch {
    return null;
  }
}

function getAccountContext(gcloudAccount: string | null, adcAccount: string | null): AccountContext {
  if (!gcloudAccount || !adcAccount) {
    return {
      ok: false,
      detail: "requires both gcloud and ADC accounts",
    };
  }
  if (gcloudAccount !== adcAccount) {
    return {
      ok: false,
      detail: `gcloud account ${gcloudAccount} differs from ADC account ${adcAccount}`,
    };
  }
  return {
    ok: true,
    detail: "gcloud and ADC accounts match",
  };
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const lastLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  return lastLine && lastLine.length > 0 ? lastLine : null;
}

function isValidProjectId(value: string): boolean {
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value);
}
