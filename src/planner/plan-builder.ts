import { OmgError } from "../types/errors.js";
import type { DetectedState, Plan } from "../types/plan.js";
import type { GcpState } from "./gcp-state.js";

export interface BuildPlanOptions {
  region?: string;
  serviceName?: string;
  siteName?: string;
}

export function buildPlan(
  detected: DetectedState,
  gcpState: GcpState,
  opts: BuildPlanOptions = {},
): Plan {
  if (detected.stack === "unknown") {
    throw new OmgError("No deployable content detected.", "NO_DEPLOYABLE_CONTENT", false);
  }

  const region = opts.region ?? gcpState.region ?? "asia-northeast3";
  const serviceName = opts.serviceName ?? gcpState.cloudRunServices[0]?.name ?? `${gcpState.projectId}-api`;
  const siteName = opts.siteName ?? gcpState.projectId;

  const plan: Plan = {
    version: 1,
    detected,
    targets: {},
    wiring: [],
    environment: {
      backend: {},
      frontend: {},
    },
    deploymentOrder: [],
    checks: [],
  };

  if (detected.stack === "static" || detected.stack === "spa-plus-api") {
    plan.targets.frontend = {
      service: "firebase-hosting",
      siteName,
    };
    plan.checks.push("Firebase Hosting target resolved");
  }

  if (detected.stack === "api-only" || detected.stack === "spa-plus-api") {
    plan.targets.backend = {
      service: "cloud-run",
      serviceName,
      region,
    };
    plan.checks.push("Cloud Run target resolved");
  }

  if (detected.stack === "spa-plus-api") {
    plan.wiring.push({
      from: "frontend.rewrites[/api/**]",
      to: "backend.cloudRun.url",
    });
    plan.deploymentOrder = ["backend", "frontend"];
    plan.checks.push("Frontend rewrites will point to the Cloud Run backend");
  } else if (detected.stack === "api-only") {
    plan.deploymentOrder = ["backend"];
  } else if (detected.stack === "static") {
    plan.deploymentOrder = ["frontend"];
  }

  return plan;
}
