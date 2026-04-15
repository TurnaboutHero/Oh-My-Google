/**
 * Plan 받아서 순차 실행. 추상화 없음 — 단순 러너.
 *
 * TODO(codex):
 * - applyPlan(plan, context): ApplyResult
 * - deploymentOrder대로 실행
 * - backend URL을 context에 저장 → frontend에 주입 (wiring)
 * - 각 단계 후 health check
 * - 실패 시 가능한 단계 롤백
 */

import type { Plan } from "../types/plan.js";
import type { TrustProfile } from "../types/trust.js";

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

export async function applyPlan(_plan: Plan, _ctx: ApplyContext): Promise<ApplyResult> {
  throw new Error("Not implemented");
}
