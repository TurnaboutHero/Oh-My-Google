import path from "node:path";
import { spawnSync } from "node:child_process";
import type {
  Connector,
  ConnectorConfig,
  ConnectorResult,
  HealthStatus,
} from "../types/connector.js";
import {
  CliRunnerError,
  type OmgError,
  ValidationError,
} from "../types/errors.js";

export type FirebaseAction =
  | "hosting.deploy"
  | "functions.deploy"
  | "emulators.start";

export interface FirebaseRequest {
  cwd?: string;
  configPath?: string;
  dryRun?: boolean;
  only?: string;
  projectId?: string;
}

export interface FirebaseCommandResult {
  action: FirebaseAction;
  command: "firebase";
  args: string[];
  cwd: string;
  dryRun: boolean;
  projectId: string;
  stdout?: string;
  stderr?: string;
}

const SUPPORTED_ACTIONS = new Set<FirebaseAction>([
  "hosting.deploy",
  "functions.deploy",
  "emulators.start",
]);

export class FirebaseConnector
  implements Connector<FirebaseRequest, FirebaseCommandResult>
{
  readonly id = "firebase" as const;
  readonly displayName = "Firebase CLI";

  async healthCheck(config: ConnectorConfig): Promise<HealthStatus> {
    const projectId = config.project.projectId;
    const check = spawnSync("firebase", ["--version"], {
      encoding: "utf-8",
    });

    if (check.error) {
      return {
        healthy: false,
        message: "firebase CLI is not available.",
        details: {
          projectId,
          error: check.error.message,
        },
      };
    }

    if (check.status !== 0) {
      return {
        healthy: false,
        message: "firebase CLI health check failed.",
        details: {
          projectId,
          exitCode: check.status,
          stderr: this.cleanOutput(check.stderr),
        },
      };
    }

    return {
      healthy: true,
      message: "firebase CLI is available.",
      details: {
        projectId,
        version: this.cleanOutput(check.stdout),
      },
    };
  }

  async execute(
    action: string,
    params: FirebaseRequest,
    config: ConnectorConfig,
  ): Promise<ConnectorResult<FirebaseCommandResult>> {
    const startedAt = Date.now();

    if (!SUPPORTED_ACTIONS.has(action as FirebaseAction)) {
      return this.failedResult(
        action,
        startedAt,
        new ValidationError(`Unsupported Firebase action: ${action}`),
      );
    }

    const typedAction = action as FirebaseAction;
    const projectId = params.projectId ?? config.project.projectId;
    const cwd = path.resolve(params.cwd ?? process.cwd());
    const dryRun = params.dryRun ?? this.defaultDryRunFor(typedAction);
    const args = this.buildArgs(typedAction, projectId, params);
    const baseData: FirebaseCommandResult = {
      action: typedAction,
      command: "firebase",
      args,
      cwd,
      dryRun,
      projectId,
    };

    if (dryRun) {
      return this.successResult(typedAction, startedAt, baseData);
    }

    const run = spawnSync("firebase", args, {
      cwd,
      encoding: "utf-8",
    });

    if (run.error) {
      return this.failedResult(
        typedAction,
        startedAt,
        new CliRunnerError(
          `Firebase command failed to start for action ${typedAction}.`,
          1,
          run.error.message,
        ),
      );
    }

    if (run.status !== 0) {
      return this.failedResult(
        typedAction,
        startedAt,
        new CliRunnerError(
          `Firebase command failed for action ${typedAction}.`,
          run.status ?? 1,
          this.cleanOutput(run.stderr) ?? "",
        ),
      );
    }

    return this.successResult(typedAction, startedAt, {
      ...baseData,
      stdout: this.cleanOutput(run.stdout),
      stderr: this.cleanOutput(run.stderr),
    });
  }

  async validate(
    result: ConnectorResult<FirebaseCommandResult>,
  ): Promise<boolean> {
    return (
      result.success &&
      result.metadata.connector === this.id &&
      SUPPORTED_ACTIONS.has(result.metadata.action as FirebaseAction) &&
      typeof result.metadata.durationMs === "number" &&
      result.data !== undefined
    );
  }

  private buildArgs(
    action: FirebaseAction,
    projectId: string,
    params: FirebaseRequest,
  ): string[] {
    const args: string[] = [];

    switch (action) {
      case "hosting.deploy":
        args.push("deploy", "--only", params.only ?? "hosting");
        break;
      case "functions.deploy":
        args.push("deploy", "--only", params.only ?? "functions");
        break;
      case "emulators.start":
        args.push("emulators:start");
        if (params.only) {
          args.push("--only", params.only);
        }
        break;
    }

    args.push("--project", projectId);

    if (params.configPath) {
      args.push("--config", params.configPath);
    }

    return args;
  }

  private defaultDryRunFor(action: FirebaseAction): boolean {
    return action === "hosting.deploy" || action === "functions.deploy";
  }

  private successResult(
    action: string,
    startedAt: number,
    data: FirebaseCommandResult,
  ): ConnectorResult<FirebaseCommandResult> {
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
  ): ConnectorResult<FirebaseCommandResult> {
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

  private cleanOutput(output: string): string | undefined {
    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
}

export const firebaseConnector = new FirebaseConnector();
