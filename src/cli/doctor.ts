import { Command } from "commander";
import { execSync } from "node:child_process";
import { AuthManager } from "../auth/auth-manager.js";
import { success, fail, getOutputFormat } from "./output.js";

export const doctorCommand = new Command("doctor")
  .description("Diagnose connection status")
  .action(async () => {
    const manager = new AuthManager();
    const status = await manager.status();

    const checks: Record<string, { ok: boolean; detail: string }> = {};

    // Config check
    checks.config = status.projectId
      ? { ok: true, detail: `project ${status.projectId}` }
      : { ok: false, detail: "no project configured" };

    // GCP ADC check
    checks.gcpAuth = status.gcp
      ? { ok: true, detail: "valid" }
      : { ok: false, detail: "not authenticated" };

    // Cloud Run API check
    if (status.projectId && status.gcp) {
      try {
        const result = execSync(
          `gcloud services list --project=${status.projectId} --filter="config.name:run.googleapis.com" --format="value(config.name)"`,
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

    // Firebase check
    try {
      execSync("firebase --version", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
      checks.firebaseCli = { ok: true, detail: "installed" };
    } catch {
      checks.firebaseCli = { ok: false, detail: "not found" };
    }

    // Jules check
    checks.jules = status.jules
      ? { ok: true, detail: "API key configured" }
      : { ok: false, detail: "API key not configured" };

    // gcloud CLI check
    try {
      const version = execSync("gcloud --version", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).split("\n")[0]?.trim();
      checks.gcloudCli = { ok: true, detail: version ?? "installed" };
    } catch {
      checks.gcloudCli = { ok: false, detail: "not found" };
    }

    // Determine next steps
    const next: string[] = [];
    if (!checks.config.ok || !checks.gcpAuth.ok) next.push("omg setup");
    if (!checks.jules.ok) next.push("omg jules setup");
    if (!checks.cloudRun.ok && checks.gcpAuth.ok) next.push("gcloud services enable run.googleapis.com");

    const allOk = Object.values(checks).every((c) => c.ok);

    if (getOutputFormat() === "json") {
      console.log(JSON.stringify({ ok: allOk, command: "doctor", data: { checks }, next }));
    } else {
      console.log("omg doctor\n");
      for (const [name, check] of Object.entries(checks)) {
        const icon = check.ok ? "✓" : "✗";
        console.log(`  ${icon} ${name}: ${check.detail}`);
      }
      if (next.length) {
        console.log("\nNext steps:");
        for (const step of next) {
          console.log(`  → ${step}`);
        }
      }
      console.log("");
    }
  });
