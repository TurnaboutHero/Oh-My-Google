/**
 * DetectedState + GcpState → Plan 조합.
 *
 * TODO(codex):
 * - buildPlan(detected, gcpState, opts): Plan
 * - spa-plus-api면 wiring 자동 삽입 (frontend.rewrites[/api/**] → backend.cloudRun.url)
 * - deploymentOrder: backend → frontend (URL 의존)
 */

import type { DetectedState, Plan } from "../types/plan.js";
import type { GcpState } from "./gcp-state.js";

export interface BuildPlanOptions {
  region?: string;
  serviceName?: string;
  siteName?: string;
}

export function buildPlan(
  _detected: DetectedState,
  _gcpState: GcpState,
  _opts: BuildPlanOptions = {},
): Plan {
  throw new Error("Not implemented");
}
