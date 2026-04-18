import path from "node:path";
import type { ExecFileException } from "node:child_process";
import { cloudRunConnector } from "../connectors/cloud-run.js";
import { firebaseConnector } from "../connectors/firebase.js";
import { execCliFile } from "../system/cli-runner.js";
import {
  AuthError,
  CliRunnerError,
  OmgError,
  QuotaError,
} from "../types/errors.js";
import type { Plan } from "../types/plan.js";
import type { TrustProfile } from "../types/trust.js";
import { resolveEnv } from "../wiring/env-inject.js";
import { injectRewrite } from "../wiring/firebase-rewrites.js";

export interface ApplyContext {
  cwd: string;
  profile: TrustProfile;
  dryRun: boolean;
  yes: boolean;
}

export interface ApplyResult {
  success: boolean;
  urls: {
    backend?: string;
    frontend?: string;
  };
  steps: Array<{
    name: string;
    state: "skipped" | "completed" | "failed";
    durationMs: number;
  }>;
}

export async function applyPlan(plan: Plan, ctx: ApplyContext): Promise<ApplyResult> {
  const urls: ApplyResult["urls"] = {};
  const steps: ApplyResult["steps"] = [];
  const rollbackActions: Array<{ name: string; run: () => Promise<void> }> = [];
  const config = {
    project: {
      projectId: ctx.profile.projectId,
      region: plan.targets.backend?.region,
    },
  };

  for (const stepName of plan.deploymentOrder) {
    const startedAt = Date.now();

    try {
      if (stepName === "backend") {
        const backendTarget = plan.targets.backend;
        if (!backendTarget) {
          steps.push({
            name: stepName,
            state: "skipped",
            durationMs: Date.now() - startedAt,
          });
          continue;
        }

        const deployResult = await cloudRunConnector.execute(
          "deploy",
          {
            service: backendTarget.serviceName,
            region: backendTarget.region,
            source: ctx.cwd,
            dryRun: ctx.dryRun,
          },
          config,
        );
        ensureConnectorSuccess(deployResult, "Cloud Run deployment failed.");

        if (!ctx.dryRun && cloudRunConnector.rollback) {
          rollbackActions.push({
            name: "rollback:backend",
            run: () => cloudRunConnector.rollback!("deploy", config),
          });
        }

        if (!ctx.dryRun) {
          const backendEnv = await resolveEnv(plan.environment.backend ?? {}, ctx.profile.projectId);
          if (Object.keys(backendEnv).length > 0) {
            await updateCloudRunEnv(
              ctx.profile.projectId,
              backendTarget.serviceName,
              backendTarget.region,
              backendEnv,
            );
          }
        }

        const describeResult = await cloudRunConnector.execute(
          "describe",
          {
            service: backendTarget.serviceName,
            region: backendTarget.region,
            dryRun: false,
          },
          config,
        );
        ensureConnectorSuccess(describeResult, "Cloud Run status check failed.");

        urls.backend = describeResult.data?.url ?? deployResult.data?.url;
        if (!ctx.dryRun && describeResult.data?.ready !== true) {
          throw new OmgError(
            "Cloud Run deployment did not report a ready revision.",
            "DEPLOY_FAILED",
            true,
          );
        }
      }

      if (stepName === "frontend") {
        const frontendTarget = plan.targets.frontend;
        if (!frontendTarget) {
          steps.push({
            name: stepName,
            state: "skipped",
            durationMs: Date.now() - startedAt,
          });
          continue;
        }

        if (!ctx.dryRun && plan.targets.backend) {
          for (const edge of plan.wiring) {
            if (edge.to === "backend.cloudRun.url") {
              await injectRewrite(ctx.cwd, {
                pattern: extractRewritePattern(edge.from),
                serviceName: plan.targets.backend.serviceName,
                region: plan.targets.backend.region,
              });
            }
          }
        }

        const deployResult = await firebaseConnector.execute(
          "hosting.deploy",
          {
            cwd: ctx.cwd,
            configPath: path.join(ctx.cwd, "firebase.json"),
            dryRun: ctx.dryRun,
          },
          config,
        );
        ensureConnectorSuccess(deployResult, "Firebase Hosting deployment failed.");

        urls.frontend = `https://${frontendTarget.siteName}.web.app`;
        if (!ctx.dryRun) {
          await verifyUrlReachable(urls.frontend);
        }
      }

      steps.push({
        name: stepName,
        state: "completed",
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      steps.push({
        name: stepName,
        state: "failed",
        durationMs: Date.now() - startedAt,
      });

      if (!ctx.dryRun) {
        for (const rollback of [...rollbackActions].reverse()) {
          const rollbackStartedAt = Date.now();
          try {
            await rollback.run();
            steps.push({
              name: rollback.name,
              state: "completed",
              durationMs: Date.now() - rollbackStartedAt,
            });
          } catch {
            steps.push({
              name: rollback.name,
              state: "failed",
              durationMs: Date.now() - rollbackStartedAt,
            });
          }
        }
      }

      throw error;
    }
  }

  return {
    success: true,
    urls,
    steps,
  };
}

function ensureConnectorSuccess<T>(
  result: { success: boolean; data?: T; error?: OmgError },
  fallbackMessage: string,
): asserts result is { success: true; data?: T } {
  if (!result.success) {
    throw result.error ?? new OmgError(fallbackMessage, "DEPLOY_FAILED", false);
  }
}

function extractRewritePattern(source: string): string {
  const match = source.match(/\[([^\]]+)\]/);
  return match?.[1] ?? "/api/**";
}

async function updateCloudRunEnv(
  projectId: string,
  serviceName: string,
  region: string,
  env: Record<string, string>,
): Promise<void> {
  try {
    await execCliFile(
      "gcloud",
      [
        "run",
        "services",
        "update",
        serviceName,
        "--project",
        projectId,
        "--region",
        region,
        "--update-env-vars",
        serializeEnv(env),
      ],
      {
        encoding: "utf-8",
        windowsHide: true,
      },
    );
  } catch (error) {
    throw mapGcloudError(error, "Failed to apply Cloud Run environment variables.");
  }
}

function serializeEnv(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
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

  return new CliRunnerError(
    message,
    typeof cliError.code === "number" ? cliError.code : 1,
    stderr,
  );
}

async function verifyUrlReachable(url: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
      });
      if (response.ok) {
        return;
      }

      lastError = new Error(`Received HTTP ${response.status} from ${url}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < 2) {
      await delay(500);
    }
  }

  throw new OmgError(
    lastError instanceof Error
      ? `Deployed frontend URL is not reachable: ${lastError.message}`
      : "Deployed frontend URL is not reachable.",
    "DEPLOY_FAILED",
    true,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
