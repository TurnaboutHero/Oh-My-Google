import type {
  Connector,
  ConnectorConfig,
  ConnectorResult,
  HealthStatus,
} from "../types/connector.js";
import { spawnCliSync } from "../system/cli-runner.js";
import { CliRunnerError, ValidationError, type OmgError } from "../types/errors.js";

export type CloudRunAction =
  | "deploy"
  | "describe"
  | "rollback"
  | "logs";

export interface CloudRunRequest {
  service?: string;
  region?: string;
  source?: string;
  allowUnauthenticated?: boolean;
  dryRun?: boolean;
  limit?: number;
}

export interface CloudRunResult {
  action: CloudRunAction;
  service: string;
  region: string;
  projectId: string;
  dryRun: boolean;
  url?: string;
  revision?: string;
  ready?: boolean;
  stdout?: string;
}

const SUPPORTED_ACTIONS = new Set<CloudRunAction>([
  "deploy",
  "describe",
  "rollback",
  "logs",
]);

export class CloudRunConnector
  implements Connector<CloudRunRequest, CloudRunResult>
{
  readonly id = "cloud-run" as const;
  readonly displayName = "Cloud Run";

  async healthCheck(config: ConnectorConfig): Promise<HealthStatus> {
    const projectId = config.project.projectId;

    // Check gcloud CLI
    const gcloudCheck = spawnCliSync("gcloud", ["--version"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (gcloudCheck.error || gcloudCheck.status !== 0) {
      return {
        healthy: false,
        message: "gcloud CLI is not available.",
        details: { projectId },
      };
    }

    // Check Cloud Run API
    const apiCheck = spawnCliSync(
      "gcloud",
      [
        "services", "list",
        "--project", projectId,
        "--filter", "config.name:run.googleapis.com",
        "--format", "value(config.name)",
      ],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );

    const apiEnabled = apiCheck.stdout?.trim().includes("run.googleapis.com");

    return {
      healthy: apiEnabled,
      message: apiEnabled ? "Cloud Run API enabled." : "Cloud Run API not enabled.",
      details: {
        projectId,
        gcloudVersion: gcloudCheck.stdout?.split("\n")[0]?.trim(),
        apiEnabled,
      },
    };
  }

  async execute(
    action: string,
    params: CloudRunRequest,
    config: ConnectorConfig,
  ): Promise<ConnectorResult<CloudRunResult>> {
    const startedAt = Date.now();

    if (!SUPPORTED_ACTIONS.has(action as CloudRunAction)) {
      return this.failedResult(action, startedAt,
        new ValidationError(`Unsupported Cloud Run action: ${action}`));
    }

    const typedAction = action as CloudRunAction;
    const projectId = config.project.projectId;
    const service = params.service ?? "app";
    const region = params.region ?? config.project.region ?? "asia-northeast3";
    const dryRun = params.dryRun ?? (typedAction === "deploy");

    const baseData: CloudRunResult = {
      action: typedAction,
      service,
      region,
      projectId,
      dryRun,
    };

    if (dryRun && typedAction === "deploy") {
      return this.successResult(typedAction, startedAt, baseData);
    }

    switch (typedAction) {
      case "deploy":
        return this.executeDeploy(params, baseData, startedAt);
      case "describe":
        return this.executeDescribe(baseData, startedAt);
      case "rollback":
        return this.executeRollback(baseData, startedAt);
      case "logs":
        return this.executeLogs(params, baseData, startedAt);
      default:
        return this.failedResult(typedAction, startedAt,
          new ValidationError(`Unknown action: ${typedAction}`));
    }
  }

  async validate(result: ConnectorResult<CloudRunResult>): Promise<boolean> {
    return result.success && result.metadata.connector === this.id;
  }

  async rollback(action: string, config: ConnectorConfig): Promise<void> {
    // Cloud Run rollback = set traffic to previous revision
    const projectId = config.project.projectId;
    const region = config.project.region ?? "asia-northeast3";

    spawnCliSync(
      "gcloud",
      ["run", "services", "update-traffic", "--to-revisions", "LATEST=0",
       "--region", region, "--project", projectId, "--quiet"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
  }

  private executeDeploy(
    params: CloudRunRequest,
    base: CloudRunResult,
    startedAt: number,
  ): ConnectorResult<CloudRunResult> {
    const args = [
      "run", "deploy", base.service,
      "--source", params.source ?? ".",
      "--region", base.region,
      "--project", base.projectId,
      "--format", "json",
      "--quiet",
    ];
    if (params.allowUnauthenticated !== false) {
      args.push("--allow-unauthenticated");
    }

    const run = spawnCliSync("gcloud", args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (run.error || run.status !== 0) {
      return this.failedResult("deploy", startedAt,
        new CliRunnerError(
          `Cloud Run deploy failed.`,
          run.status ?? 1,
          run.stderr?.trim() ?? "",
        ));
    }

    let url: string | undefined;
    let revision: string | undefined;
    try {
      const parsed = JSON.parse(run.stdout);
      url = parsed.status?.url;
      revision = parsed.status?.latestReadyRevisionName;
    } catch {
      // non-JSON output, use raw
    }

    return this.successResult("deploy", startedAt, {
      ...base,
      dryRun: false,
      url,
      revision,
      stdout: run.stdout?.trim(),
    });
  }

  private executeDescribe(
    base: CloudRunResult,
    startedAt: number,
  ): ConnectorResult<CloudRunResult> {
    const run = spawnCliSync(
      "gcloud",
      [
        "run", "services", "describe", base.service,
        "--region", base.region,
        "--project", base.projectId,
        "--format", "json",
      ],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );

    if (run.error || run.status !== 0) {
      return this.failedResult("describe", startedAt,
        new CliRunnerError(
          `Could not describe service ${base.service}.`,
          run.status ?? 1,
          run.stderr?.trim() ?? "",
        ));
    }

    let url: string | undefined;
    let revision: string | undefined;
    let ready: boolean | undefined;
    try {
      const parsed = JSON.parse(run.stdout);
      url = parsed.status?.url;
      revision = parsed.status?.latestReadyRevisionName;
      ready = parsed.status?.conditions?.[0]?.status === "True";
    } catch {
      // fallback
    }

    return this.successResult("describe", startedAt, {
      ...base,
      url,
      revision,
      ready,
    });
  }

  private executeRollback(
    base: CloudRunResult,
    startedAt: number,
  ): ConnectorResult<CloudRunResult> {
    const run = spawnCliSync(
      "gcloud",
      [
        "run", "services", "update-traffic", base.service,
        "--to-revisions", "LATEST=0",
        "--region", base.region,
        "--project", base.projectId,
        "--quiet",
      ],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );

    if (run.error || run.status !== 0) {
      return this.failedResult("rollback", startedAt,
        new CliRunnerError(
          `Cloud Run rollback failed.`,
          run.status ?? 1,
          run.stderr?.trim() ?? "",
        ));
    }

    return this.successResult("rollback", startedAt, { ...base, dryRun: false });
  }

  private executeLogs(
    params: CloudRunRequest,
    base: CloudRunResult,
    startedAt: number,
  ): ConnectorResult<CloudRunResult> {
    const limit = params.limit ?? 20;
    const run = spawnCliSync(
      "gcloud",
      [
        "run", "services", "logs", "read", base.service,
        "--region", base.region,
        "--project", base.projectId,
        "--limit", String(limit),
      ],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );

    if (run.error || run.status !== 0) {
      return this.failedResult("logs", startedAt,
        new CliRunnerError(
          `Could not fetch logs for ${base.service}.`,
          run.status ?? 1,
          run.stderr?.trim() ?? "",
        ));
    }

    return this.successResult("logs", startedAt, {
      ...base,
      stdout: run.stdout?.trim(),
    });
  }

  private successResult(
    action: string,
    startedAt: number,
    data: CloudRunResult,
  ): ConnectorResult<CloudRunResult> {
    return {
      success: true,
      data,
      metadata: {
        connector: this.id,
        action,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    };
  }

  private failedResult(
    action: string,
    startedAt: number,
    error: OmgError,
  ): ConnectorResult<CloudRunResult> {
    return {
      success: false,
      error,
      metadata: {
        connector: this.id,
        action,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

export const cloudRunConnector = new CloudRunConnector();
