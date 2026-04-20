import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execCliFile } from "../system/cli-runner.js";
import { AuthError } from "../types/errors.js";

export interface ProjectProfile {
  projectId: string;
  defaultRegion?: string;
  accountEmail?: string;
}

export interface OmgConfig {
  profile: ProjectProfile;
}

export interface AuthStatus {
  projectId: string | null;
  adcConfigured: boolean;
  adcAccount: string | null;
  gcloudAccount: string | null;
  gcp: boolean;
}

export interface AuthProvider {
  readonly name: string;
  isConfigured(): Promise<boolean>;
  validate(): Promise<boolean>;
}

export class GcpAuthProvider implements AuthProvider {
  readonly name = "GCP ADC";

  async isConfigured(): Promise<boolean> {
    for (const candidate of getAdcPaths()) {
      try {
        await fs.access(candidate);
        return true;
      } catch {
        // Check the next known ADC location.
      }
    }

    return false;
  }

  async validate(): Promise<boolean> {
    return this.isConfigured();
  }
}

const OMG_DIR = path.join(os.homedir(), ".omg");
const CONFIG_PATH = path.join(OMG_DIR, "config.json");

export class AuthManager {
  private gcpProvider = new GcpAuthProvider();

  static async loadConfig(configPath = CONFIG_PATH): Promise<OmgConfig | null> {
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      return JSON.parse(raw) as OmgConfig;
    } catch {
      return null;
    }
  }

  static async saveConfig(config: OmgConfig, configPath = CONFIG_PATH): Promise<void> {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  async getProjectId(): Promise<string> {
    const config = await AuthManager.loadConfig();
    if (!config?.profile.projectId) {
      throw new AuthError("No project configured. Run 'omg init' first.");
    }
    return config.profile.projectId;
  }

  async getGcpAuth() {
    const { GoogleAuth } = await import("google-auth-library");
    const projectId = await this.getProjectId();
    return new GoogleAuth({
      projectId,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }

  async status(): Promise<AuthStatus> {
    const config = await AuthManager.loadConfig();
    const adcConfigured = await this.gcpProvider.isConfigured();
    const adcAccount = adcConfigured ? await getAdcAccount() : null;
    const gcloudAccount = await getActiveGcloudAccount();

    return {
      projectId: config?.profile.projectId ?? null,
      adcConfigured,
      adcAccount,
      gcloudAccount,
      gcp: adcConfigured && gcloudAccount !== null,
    };
  }
}

function getAdcPaths(): string[] {
  const candidates: string[] = [];
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    candidates.push(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }

  if (process.platform === "win32" && process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, "gcloud", "application_default_credentials.json"));
  } else {
    candidates.push(path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json"));
  }

  return candidates;
}

async function getActiveGcloudAccount(): Promise<string | null> {
  try {
    const { stdout } = await execCliFile(
      "gcloud",
      [
        "auth",
        "list",
        "--filter=status:ACTIVE",
        "--format=value(account)",
      ],
      {
        encoding: "utf-8",
        windowsHide: true,
      },
    );

    const account = stdout.trim();
    return account.length > 0 ? account : null;
  } catch {
    return null;
  }
}

async function getAdcAccount(): Promise<string | null> {
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
    return typeof payload.email === "string" && payload.email.length > 0
      ? payload.email
      : null;
  } catch {
    return null;
  }
}
