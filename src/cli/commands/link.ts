import { Command } from "commander";
import { AuthManager } from "../../auth/auth-manager.js";
import { createRunId, tryAppendDecision } from "../../harness/decision-log.js";
import { buildPlan } from "../../planner/plan-builder.js";
import { detect } from "../../planner/detect.js";
import { fetchGcpState } from "../../planner/gcp-state.js";
import { savePlan } from "../../planner/schema.js";
import { execCliFile } from "../../system/cli-runner.js";
import { OmgError, ValidationError } from "../../types/errors.js";
import type { Plan } from "../../types/plan.js";
import { fail, success } from "../output.js";

export interface RunLinkInput {
  cwd: string;
  region?: string;
  service?: string;
  site?: string;
}

export interface LinkPayload {
  plan: Plan;
}

export interface LinkErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
  hint?: string;
  data?: Record<string, unknown>;
}

export type RunLinkOutcome =
  | { ok: true; data: LinkPayload; next?: string[] }
  | { ok: false; error: LinkErrorPayload };

export const linkCommand = new Command("link")
  .description("Analyze the repo and write .omg/project.yaml")
  .option("--region <region>", "Override the deployment region")
  .option("--service-name <name>", "Override the Cloud Run service name")
  .option("--site-name <name>", "Override the Firebase Hosting site name")
  .action(async (opts) => {
    const outcome = await runLink({
      cwd: process.cwd(),
      region: opts.region as string | undefined,
      service: opts.serviceName as string | undefined,
      site: opts.siteName as string | undefined,
    });

    if (outcome.ok) {
      success("link", "Deployment plan created.", { plan: outcome.data.plan }, outcome.next);
      return;
    }

    fail(
      "link",
      outcome.error.code,
      outcome.error.message,
      outcome.error.recoverable,
      outcome.error.hint,
      outcome.error.data,
    );
    process.exit(1);
  });

export async function runLink(input: RunLinkInput): Promise<RunLinkOutcome> {
  const runId = createRunId("link");
  try {
    const detected = await detect(input.cwd);
    if (detected.stack === "unknown") {
      throw new OmgError("No deployable content detected.", "NO_DEPLOYABLE_CONTENT", false);
    }

    const config = await AuthManager.loadConfig();
    const projectId = config?.profile.projectId ?? (await getActiveProjectId());
    if (!projectId) {
      throw new OmgError("No project configured. Run 'omg init' first.", "NO_PROJECT", false);
    }

    const gcpState = await fetchGcpState(projectId);
    const plan = buildPlan(detected, gcpState, {
      region: input.region ?? config?.profile.defaultRegion,
      serviceName: input.service,
      siteName: input.site,
    });

    await savePlan(input.cwd, plan);

    const outcome: RunLinkOutcome = { ok: true, data: { plan }, next: ["omg deploy --dry-run"] };
    await tryAppendDecision(input.cwd, {
      runId,
      command: "link",
      phase: "plan",
      status: "success",
      projectId,
      result: {
        stack: plan.detected.stack,
        targets: Object.keys(plan.targets),
        deploymentOrder: plan.deploymentOrder,
      },
      artifacts: { plan: ".omg/project.yaml" },
      next: outcome.next,
    });
    return outcome;
  } catch (error) {
    const omgError =
      error instanceof OmgError
        ? error
        : new ValidationError(error instanceof Error ? error.message : "Unknown link error.");

    const outcome: RunLinkOutcome = {
      ok: false,
      error: {
        code: omgError.code,
        message: omgError.message,
        recoverable: omgError.recoverable,
        hint:
          omgError.code === "NO_DEPLOYABLE_CONTENT"
            ? "Add a Dockerfile, firebase.json, or a buildable frontend before linking."
            : undefined,
      },
    };
    await tryAppendDecision(input.cwd, {
      runId,
      command: "link",
      phase: "plan",
      status: "failure",
      result: outcome.error,
      next: outcome.error.hint ? [outcome.error.hint] : undefined,
    });
    return outcome;
  }
}

async function getActiveProjectId(): Promise<string | undefined> {
  try {
    const { stdout } = await execCliFile(
      "gcloud",
      ["config", "get-value", "project", "--format=json"],
      {
        encoding: "utf-8",
        windowsHide: true,
      },
    );
    const value = stdout.trim();
    if (!value || value === "(unset)") {
      return undefined;
    }

    try {
      const parsed = JSON.parse(value) as string;
      return parsed === "(unset)" ? undefined : parsed;
    } catch {
      return value;
    }
  } catch {
    return undefined;
  }
}

linkCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg link
  omg link --region asia-northeast3
  omg --output json link --service-name my-api --site-name my-site
`,
);
