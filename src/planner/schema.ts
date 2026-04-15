/**
 * `.omg/project.yaml` 읽기/쓰기.
 *
 * TODO(codex):
 * - loadPlan(cwd): Plan | null
 * - savePlan(cwd, plan): void  (yaml.stringify)
 * - validatePlan(raw): Plan | throw
 */

import type { Plan } from "../types/plan.js";

export async function loadPlan(_cwd: string): Promise<Plan | null> {
  throw new Error("Not implemented");
}

export async function savePlan(_cwd: string, _plan: Plan): Promise<void> {
  throw new Error("Not implemented");
}

export function validatePlan(_raw: unknown): Plan {
  throw new Error("Not implemented");
}
