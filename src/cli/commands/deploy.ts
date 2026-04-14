import { Command } from "commander";
import { AuthManager } from "../../auth/auth-manager.js";
import { success, fail, info, getOutputFormat } from "../output.js";

export const deployCommand = new Command("deploy")
  .description("Deploy to Cloud Run")
  .option("--service <name>", "Service name")
  .option("--region <region>", "Deployment region")
  .option("--source <path>", "Source directory", ".")
  .option("--dry-run", "Show deployment plan without executing")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (opts) => {
    const manager = new AuthManager();

    // 1. Auth check
    const status = await manager.status();
    if (!status.projectId || !status.gcp) {
      fail("deploy", "AUTH_ERROR", "Not authenticated.", false, "Run 'omg setup' first.");
      process.exit(1);
    }

    const projectId = status.projectId;
    const service = (opts.service as string) ?? "app";
    const region = (opts.region as string) ?? "asia-northeast3";
    const source = opts.source as string;
    const dryRun = !!opts.dryRun;

    const plan = { projectId, service, region, source };

    // 2. Dry-run: show plan and exit
    if (dryRun) {
      success("deploy:dry-run", "Deployment plan ready.", plan, [
        "omg deploy --yes  (execute deployment)",
      ]);
      return;
    }

    // 3. Confirmation (skip in JSON mode or --yes)
    if (!opts.yes && getOutputFormat() !== "json") {
      const readline = await import("node:readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = await new Promise<string>((resolve) => {
        rl.question(`Deploy ${service} to ${region}? (y/N) `, resolve);
      });
      rl.close();
      if (answer.toLowerCase() !== "y") {
        fail("deploy", "CANCELLED", "Deployment cancelled by user.", false);
        return;
      }
    }

    // 4. Deploy
    try {
      const { execSync } = await import("node:child_process");
      const output = execSync(
        `gcloud run deploy ${service} --source=${source} --region=${region} --project=${projectId} --allow-unauthenticated --quiet --format=json`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );

      let deployResult: Record<string, unknown> = plan;
      try {
        const parsed = JSON.parse(output);
        deployResult = {
          ...plan,
          url: parsed.status?.url,
          revision: parsed.status?.latestReadyRevisionName,
        };
      } catch {
        // gcloud didn't return JSON, use plan data
      }

      success("deploy", `Deployed ${service} to ${region}.`, deployResult, [
        "omg deploy status  (check service status)",
        "omg deploy logs    (view logs)",
      ]);
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      fail("deploy", "DEPLOY_FAILED", `Deploy failed: ${stderr}`, false, "Check gcloud logs.");
      process.exit(1);
    }
  });

deployCommand
  .command("status")
  .description("Show deployment status")
  .option("--service <name>", "Service name")
  .option("--region <region>", "Region")
  .action(async (opts) => {
    const manager = new AuthManager();
    const projectId = await manager.getProjectId();
    const service = (opts.service as string) ?? "app";
    const region = (opts.region as string) ?? "asia-northeast3";

    try {
      const { execSync } = await import("node:child_process");
      const result = execSync(
        `gcloud run services describe ${service} --region=${region} --project=${projectId} --format=json`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );
      const parsed = JSON.parse(result);
      info("deploy:status", {
        service,
        region,
        url: parsed.status?.url ?? "unknown",
        ready: parsed.status?.conditions?.[0]?.status === "True",
        revision: parsed.status?.latestReadyRevisionName ?? "unknown",
      });
    } catch {
      fail("deploy:status", "STATUS_ERROR", `Could not get status for ${service}.`, true);
    }
  });

deployCommand
  .command("logs")
  .description("View recent deployment logs")
  .option("--service <name>", "Service name")
  .option("--region <region>", "Region")
  .action(async (opts) => {
    const manager = new AuthManager();
    const projectId = await manager.getProjectId();
    const service = (opts.service as string) ?? "app";
    const region = (opts.region as string) ?? "asia-northeast3";

    try {
      const { execSync } = await import("node:child_process");
      execSync(
        `gcloud run services logs read ${service} --region=${region} --project=${projectId} --limit=20`,
        { stdio: "inherit" },
      );
    } catch {
      fail("deploy:logs", "LOGS_ERROR", `Could not fetch logs for ${service}.`, true);
    }
  });
