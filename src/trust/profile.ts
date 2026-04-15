import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import type { TrustProfile } from "../types/trust.js";
import { ValidationError } from "../types/errors.js";

const TRUST_FILE = ".omg/trust.yaml";

export async function loadProfile(cwd: string): Promise<TrustProfile | null> {
  try {
    const raw = await fs.readFile(getProfilePath(cwd), "utf-8");
    return validateProfile(parse(raw));
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}

export async function saveProfile(cwd: string, profile: TrustProfile): Promise<void> {
  const filePath = getProfilePath(cwd);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringify(profile), "utf-8");
}

export function generateDefaultProfile(
  projectId: string,
  environment: TrustProfile["environment"],
): TrustProfile {
  const now = new Date().toISOString();

  return {
    version: 1,
    projectId,
    environment,
    budgetCapUsdMonthly: environment === "prod" ? 200 : 50,
    allowedServices: ["cloud-run", "firebase-hosting"],
    allowedRegions: ["asia-northeast3"],
    rules: getRulesForEnvironment(environment),
    createdAt: now,
    updatedAt: now,
  };
}

function getProfilePath(cwd: string): string {
  return path.join(cwd, TRUST_FILE);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function getRulesForEnvironment(
  environment: TrustProfile["environment"],
): TrustProfile["rules"] {
  switch (environment) {
    case "local":
    case "dev":
      return {
        L0: "auto",
        L1: "auto",
        L2: "require_confirm",
        L3: "deny",
      };
    case "staging":
      return {
        L0: "auto",
        L1: "require_confirm",
        L2: "require_approval",
        L3: "deny",
      };
    case "prod":
      return {
        L0: "auto",
        L1: "require_approval",
        L2: "require_approval",
        L3: "deny",
      };
  }
}

function validateProfile(raw: unknown): TrustProfile {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("Trust profile must be a YAML object.");
  }

  const profile = raw as Partial<TrustProfile>;
  if (profile.version !== 1) {
    throw new ValidationError("Trust profile version must be 1.");
  }

  if (!profile.projectId || typeof profile.projectId !== "string") {
    throw new ValidationError("Trust profile requires a projectId.");
  }

  if (!profile.environment || !isEnvironment(profile.environment)) {
    throw new ValidationError("Trust profile requires a valid environment.");
  }

  if (!profile.rules || typeof profile.rules !== "object") {
    throw new ValidationError("Trust profile requires rules for all trust levels.");
  }

  return {
    version: 1,
    projectId: profile.projectId,
    environment: profile.environment,
    budgetCapUsdMonthly:
      typeof profile.budgetCapUsdMonthly === "number"
        ? profile.budgetCapUsdMonthly
        : undefined,
    allowedServices: normalizeStringArray(profile.allowedServices),
    allowedRegions: normalizeStringArray(profile.allowedRegions),
    rules: {
      L0: validateRule(profile.rules.L0, "L0"),
      L1: validateRule(profile.rules.L1, "L1"),
      L2: validateRule(profile.rules.L2, "L2"),
      L3: validateRule(profile.rules.L3, "L3"),
    },
    createdAt:
      typeof profile.createdAt === "string"
        ? profile.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof profile.updatedAt === "string"
        ? profile.updatedAt
        : new Date().toISOString(),
  };
}

function isEnvironment(value: string): value is TrustProfile["environment"] {
  return ["local", "dev", "staging", "prod"].includes(value);
}

function validateRule(
  value: unknown,
  level: keyof TrustProfile["rules"],
): TrustProfile["rules"][typeof level] {
  if (
    value === "auto" ||
    value === "require_confirm" ||
    value === "require_approval" ||
    value === "deny"
  ) {
    return value;
  }

  throw new ValidationError(`Trust rule ${level} is invalid.`);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}
