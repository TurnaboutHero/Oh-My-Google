import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { OmgError, ValidationError } from "../types/errors.js";
import type { Plan } from "../types/plan.js";

const PLAN_FILE = ".omg/project.yaml";

export async function loadPlan(cwd: string): Promise<Plan | null> {
  try {
    const raw = await fs.readFile(getPlanPath(cwd), "utf-8");
    return validatePlan(parse(raw));
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

export async function savePlan(cwd: string, plan: Plan): Promise<void> {
  const filePath = getPlanPath(cwd);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringify(plan), "utf-8");
}

export function validatePlan(raw: unknown): Plan {
  if (!raw || typeof raw !== "object") {
    throw new OmgError("Project plan is malformed.", "INVALID_PLAN", false);
  }

  const plan = raw as Partial<Plan>;
  if (plan.version !== 1) {
    throw new ValidationError("Project plan version must be 1.");
  }

  if (!plan.detected || typeof plan.detected !== "object") {
    throw new OmgError("Project plan is missing detected stack data.", "INVALID_PLAN", false);
  }

  if (!Array.isArray(plan.deploymentOrder)) {
    throw new OmgError("Project plan is missing deploymentOrder.", "INVALID_PLAN", false);
  }

  if (!plan.targets || typeof plan.targets !== "object") {
    throw new OmgError("Project plan is missing targets.", "INVALID_PLAN", false);
  }

  return {
    ...plan,
    warnings: Array.isArray(plan.warnings)
      ? plan.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
  } as Plan;
}

function getPlanPath(cwd: string): string {
  return path.join(cwd, PLAN_FILE);
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
