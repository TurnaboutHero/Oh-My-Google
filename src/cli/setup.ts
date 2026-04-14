import { Command } from "commander";
import { execSync } from "node:child_process";
import { AuthManager } from "../auth/auth-manager.js";
import { success, fail } from "./output.js";

export const setupCommand = new Command("setup")
  .description("Configure GCP project and authenticate")
  .option("--project-id <id>", "GCP project ID")
  .action(async (opts) => {
    let projectId = opts.projectId as string | undefined;

    if (!projectId) {
      try {
        projectId = execSync("gcloud config get-value project", {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
      } catch {
        // gcloud not available
      }
    }

    if (!projectId) {
      fail("setup", "NO_PROJECT", "No project ID provided.", false,
        "Use --project-id or configure gcloud first.");
      process.exit(1);
    }

    // Run ADC login
    try {
      execSync("gcloud auth application-default login", { stdio: "inherit" });
    } catch {
      fail("setup", "AUTH_FAILED", "Failed to authenticate.", false,
        "Is gcloud CLI installed?");
      process.exit(1);
    }

    await AuthManager.saveConfig({
      profile: { projectId },
    });

    success("setup", `Project ${projectId} configured.`, { projectId }, [
      "omg doctor  (verify connections)",
      "omg deploy --dry-run  (test deployment)",
    ]);
  });
