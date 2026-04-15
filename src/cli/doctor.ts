import { Command } from "commander";
import { execFileSync } from "node:child_process";
import { AuthManager } from "../auth/auth-manager.js";
import { getOutputFormat } from "./output.js";

export const doctorCommand = new Command("doctor")
  .description("Diagnose connection status")
  .action(async () => {
    const manager = new AuthManager();
    const status = await manager.status();

    const checks: Record<string, { ok: boolean; detail: string }> = {};

    checks.config = status.projectId
      ? { ok: true, detail: `project ${status.projectId}` }
      : { ok: false, detail: "no project configured" };

    checks.gcpAuth = status.gcp
      ? { ok: true, detail: "valid" }
      : { ok: false, detail: "not authenticated" };

    if (status.projectId && status.gcp) {
      try {
        const result = execFileSync(
          "gcloud",
          [
            "services",
            "list",
            `--project=${status.projectId}`,
            "--filter=config.name:run.googleapis.com",
            "--format=value(config.name)",
          ],
          { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
        ).trim();
        checks.cloudRun = result.includes("run.googleapis.com")
          ? { ok: true, detail: "API enabled" }
          : { ok: false, detail: "API not enabled" };
      } catch {
        checks.cloudRun = { ok: false, detail: "could not check" };
      }
    } else {
      checks.cloudRun = { ok: false, detail: "requires auth first" };
    }

    try {
      execFileSync("firebase", ["--version"], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      checks.firebaseCli = { ok: true, detail: "installed" };
    } catch {
      checks.firebaseCli = { ok: false, detail: "not found" };
    }

    try {
      const version = execFileSync("gcloud", ["--version"], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).split("\n")[0]?.trim();
      checks.gcloudCli = { ok: true, detail: version ?? "installed" };
    } catch {
      checks.gcloudCli = { ok: false, detail: "not found" };
    }

    const next: string[] = [];
    if (!checks.config.ok || !checks.gcpAuth.ok) {
      next.push("omg init");
    }
    if (!checks.cloudRun.ok && checks.gcpAuth.ok) {
      next.push("gcloud services enable run.googleapis.com");
    }

    const allOk = Object.values(checks).every((check) => check.ok);

    if (getOutputFormat() === "json") {
      console.log(JSON.stringify({ ok: allOk, command: "doctor", data: { checks }, next }));
      return;
    }

    console.log("omg doctor");
    console.log("");
    for (const [name, check] of Object.entries(checks)) {
      console.log(`${name}: ${check.detail} (${check.ok ? "ok" : "needs attention"})`);
    }
    if (next.length > 0) {
      console.log("");
      console.log("Next:");
      for (const step of next) {
        console.log(`- ${step}`);
      }
    }
  });
