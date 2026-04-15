import { Command } from "commander";
import { AuthManager } from "../auth/auth-manager.js";
import { success, fail, info } from "./output.js";

export const authCommand = new Command("auth")
  .description("Check or manage authentication")
  .action(async () => {
    const manager = new AuthManager();
    const status = await manager.status();

    info("auth:status", {
      projectId: status.projectId ?? "(not configured)",
      gcpAdc: status.gcp,
    });
  });

authCommand
  .command("refresh")
  .description("Refresh authentication tokens")
  .action(async () => {
    const { execSync } = await import("node:child_process");
    try {
      execSync("gcloud auth application-default login", { stdio: "inherit" });
      success("auth:refresh", "Token refreshed.");
    } catch {
      fail("auth:refresh", "REFRESH_FAILED", "Failed to refresh token.", false, "Is gcloud CLI installed?");
      process.exit(1);
    }
  });

authCommand
  .command("logout")
  .description("Remove stored credentials")
  .action(async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const configPath = path.join(os.homedir(), ".omg", "config.json");
    try {
      await fs.unlink(configPath);
      success("auth:logout", "Credentials removed.");
    } catch {
      success("auth:logout", "No credentials to remove.");
    }
  });
