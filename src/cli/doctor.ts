import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { AuthManager } from "../auth/auth-manager.js";
import { getOutputFormat } from "./output.js";

interface CheckResult {
  ok: boolean;
  detail: string;
}

export const doctorCommand = new Command("doctor")
  .description("Diagnose connection status")
  .action(async () => {
    const manager = new AuthManager();
    const status = await manager.status();

    const checks: Record<string, CheckResult> = {};

    checks.config = status.projectId
      ? { ok: true, detail: `project ${status.projectId}` }
      : { ok: false, detail: "no project configured" };

    checks.adcCredentials = status.adcConfigured
      ? { ok: true, detail: "application default credentials file found" }
      : { ok: false, detail: "ADC credentials not found" };

    checks.gcloudAccount = status.gcloudAccount
      ? { ok: true, detail: status.gcloudAccount }
      : { ok: false, detail: "no active gcloud account" };

    if (status.projectId && status.gcloudAccount) {
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
      checks.cloudRun = { ok: false, detail: "requires an active gcloud account" };
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

    checks.firebaseProjectLink = await getFirebaseProjectLinkCheck(status.projectId);

    const next: string[] = [];
    if (!checks.config.ok || !checks.adcCredentials.ok || !checks.gcloudAccount.ok) {
      next.push("omg init");
    }
    if (!checks.cloudRun.ok && checks.gcloudAccount.ok && status.projectId) {
      next.push("gcloud services enable run.googleapis.com");
    }
    if (!checks.firebaseProjectLink.ok) {
      next.push("link the Firebase project in .firebaserc");
    }

    const blockingChecks = [
      "config",
      "adcCredentials",
      "gcloudAccount",
      "cloudRun",
      "firebaseCli",
      "gcloudCli",
      "firebaseProjectLink",
    ];
    const allOk = blockingChecks.every((name) => checks[name]?.ok);

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

async function getFirebaseProjectLinkCheck(projectId: string | null): Promise<CheckResult> {
  const firebaseJsonPath = path.join(process.cwd(), "firebase.json");
  const firebasercPath = path.join(process.cwd(), ".firebaserc");

  const hasFirebaseJson = await fileExists(firebaseJsonPath);
  const hasFirebaserc = await fileExists(firebasercPath);

  if (!hasFirebaseJson && !hasFirebaserc) {
    return {
      ok: true,
      detail: "not applicable in this repository",
    };
  }

  if (!hasFirebaserc) {
    return {
      ok: false,
      detail: "firebase.json found but .firebaserc is missing",
    };
  }

  try {
    const raw = await fs.readFile(firebasercPath, "utf-8");
    const config = JSON.parse(raw) as {
      projects?: {
        default?: string;
      };
    };
    const linkedProject = config.projects?.default ?? null;

    if (!linkedProject) {
      return {
        ok: false,
        detail: "no default Firebase project linked",
      };
    }

    if (projectId && linkedProject !== projectId) {
      return {
        ok: false,
        detail: `linked to ${linkedProject}, but omg config points to ${projectId}`,
      };
    }

    return {
      ok: true,
      detail: `linked to ${linkedProject}`,
    };
  } catch {
    return {
      ok: false,
      detail: "could not parse .firebaserc",
    };
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
