import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AuthError } from "../types/errors.js";

export interface ProjectProfile {
  projectId: string;
  defaultRegion?: string;
  accountEmail?: string;
}

export interface OmgConfig {
  profile: ProjectProfile;
}

export interface AuthProvider {
  readonly name: string;
  isConfigured(): Promise<boolean>;
  validate(): Promise<boolean>;
}

export class GcpAuthProvider implements AuthProvider {
  readonly name = "GCP ADC";

  async isConfigured(): Promise<boolean> {
    // Check if ADC credentials exist
    try {
      const { GoogleAuth } = await import("google-auth-library");
      const auth = new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
      await auth.getClient();
      return true;
    } catch {
      return false;
    }
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
      throw new AuthError("No project configured. Run 'omg setup' first.");
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

  async status(): Promise<{
    projectId: string | null;
    gcp: boolean;
  }> {
    const config = await AuthManager.loadConfig();
    return {
      projectId: config?.profile.projectId ?? null,
      gcp: await this.gcpProvider.isConfigured(),
    };
  }
}
