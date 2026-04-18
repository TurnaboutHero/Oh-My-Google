import type { ExecFileException } from "node:child_process";
import { execCliFile } from "../system/cli-runner.js";
import { AuthError, CliRunnerError, OmgError, ValidationError } from "../types/errors.js";

export type ProjectRisk = "low" | "review" | "do_not_touch";

export interface ProjectAudit {
  projectId: string;
  name?: string;
  lifecycleState?: string;
  createTime?: string;
  parent?: { type?: string; id?: string };
  billingEnabled?: boolean;
  billingAccountName?: string;
  callerRoles: string[];
  enabledServices: string[];
  serviceAccounts: string[];
  inaccessible: string[];
  signals: string[];
  risk: ProjectRisk;
  recommendedAction: string;
}

export interface CleanupPlan {
  projectId: string;
  dryRun: true;
  allowedToExecute: false;
  risk: ProjectRisk;
  steps: string[];
  next: string[];
}

export interface ProjectDeleteResult {
  projectId: string;
  lifecycleState: string;
}

export type ProjectAuditExecutor = (
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export async function auditProject(
  projectId: string,
  executor: ProjectAuditExecutor = runGcloud,
): Promise<ProjectAudit> {
  const normalizedProjectId = normalizeProjectId(projectId);
  const describe = await readJsonObject(
    executor,
    ["projects", "describe", normalizedProjectId, "--format=json"],
    "project metadata",
  );
  const billing = await readJsonObject(
    executor,
    ["billing", "projects", "describe", normalizedProjectId, "--format=json"],
    "billing metadata",
  );
  const activeAccount = await readActiveAccount(executor);
  const rolesResult = await readJsonArrayOrInaccessible(
    executor,
    [
      "projects",
      "get-iam-policy",
      normalizedProjectId,
      "--flatten=bindings[].members",
      `--filter=bindings.members:user:${activeAccount}`,
      "--format=json",
    ],
    "iam policy",
  );
  const servicesResult = await readJsonArrayOrInaccessible(
    executor,
    ["services", "list", "--enabled", `--project=${normalizedProjectId}`, "--format=json"],
    "enabled services",
  );
  const serviceAccountsResult = await readJsonArrayOrInaccessible(
    executor,
    ["iam", "service-accounts", "list", `--project=${normalizedProjectId}`, "--format=json"],
    "service accounts",
  );

  const audit: ProjectAudit = {
    projectId: normalizedProjectId,
    name: stringValue(describe.name),
    lifecycleState: stringValue(describe.lifecycleState),
    createTime: stringValue(describe.createTime),
    parent: parseParent(describe.parent),
    billingEnabled: booleanValue(billing.billingEnabled),
    billingAccountName: stringValue(billing.billingAccountName),
    callerRoles: rolesResult.rows.map((row) => stringValue(getNested(row, ["bindings", "role"]))).filter(Boolean).sort(),
    enabledServices: servicesResult.rows
      .map((row) => stringValue(getNested(row, ["config", "name"])))
      .filter(Boolean)
      .sort(),
    serviceAccounts: serviceAccountsResult.rows
      .map((row) => stringValue(row.email))
      .filter(Boolean)
      .sort(),
    inaccessible: [
      ...rolesResult.inaccessible,
      ...servicesResult.inaccessible,
      ...serviceAccountsResult.inaccessible,
    ],
    signals: [],
    risk: "review",
    recommendedAction: "",
  };

  return classifyAudit(audit);
}

export function buildCleanupPlan(audit: ProjectAudit): CleanupPlan {
  const steps = [
    "Review project ownership and enabled APIs in Google Cloud Console.",
    "Confirm the project is not used by Gemini, Firebase, Antigravity, Stitch, or shared collaborators.",
    "If cleanup is still desired, perform deletion manually or add a separately approved L3 workflow.",
  ];

  if (audit.risk === "do_not_touch") {
    steps.unshift("Do not modify this project from omg.");
  }

  return {
    projectId: audit.projectId,
    dryRun: true,
    allowedToExecute: false,
    risk: audit.risk,
    steps,
    next: ["No automated cleanup command is available."],
  };
}

export async function deleteProject(
  projectId: string,
  executor: ProjectAuditExecutor = runGcloud,
): Promise<ProjectDeleteResult> {
  const normalizedProjectId = normalizeProjectId(projectId);
  await executor(["projects", "delete", normalizedProjectId, "--quiet"]);
  const describe = await readJsonObject(
    executor,
    ["projects", "describe", normalizedProjectId, "--format=json"],
    "project delete status",
  );

  return {
    projectId: normalizedProjectId,
    lifecycleState: stringValue(describe.lifecycleState),
  };
}

function classifyAudit(audit: ProjectAudit): ProjectAudit {
  const signals: string[] = [];

  if (audit.parent?.id) {
    signals.push(`Project belongs to ${audit.parent.type ?? "parent"} ${audit.parent.id}.`);
  }
  if (audit.inaccessible.includes("iam policy")) {
    signals.push("Caller does not have IAM policy visibility.");
  }
  if (audit.billingEnabled) {
    signals.push("Billing is enabled.");
  }
  for (const account of audit.serviceAccounts) {
    signals.push(`Service account present: ${account}`);
  }
  for (const service of audit.enabledServices) {
    if (service.includes("generativelanguage") || service.includes("gmail") || service.includes("bigquery")) {
      signals.push(`Enabled API may indicate prior use: ${service}`);
    }
  }

  const hasOwner = audit.callerRoles.includes("roles/owner");
  const risk: ProjectRisk =
    audit.parent?.id || audit.inaccessible.includes("iam policy") || (audit.billingEnabled && !hasOwner)
      ? "do_not_touch"
      : signals.length > 0
        ? "review"
        : "low";

  return {
    ...audit,
    signals,
    risk,
    recommendedAction:
      risk === "do_not_touch"
        ? "Do not modify this project until ownership and billing responsibility are confirmed."
        : "Review in Google Cloud Console before cleanup; no automated deletion is available.",
  };
}

async function runGcloud(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execCliFile("gcloud", args, {
      encoding: "utf-8",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 10,
    });
  } catch (error) {
    throw mapGcloudError(error, "gcloud project audit command failed.");
  }
}

async function readActiveAccount(executor: ProjectAuditExecutor): Promise<string> {
  try {
    const { stdout } = await executor(["config", "get-value", "account"]);
    const account = stdout.trim();
    return account || "*";
  } catch {
    return "*";
  }
}

async function readJsonObject(
  executor: ProjectAuditExecutor,
  args: string[],
  label: string,
): Promise<Record<string, unknown>> {
  try {
    const { stdout } = await executor(args);
    return JSON.parse(stdout || "{}") as Record<string, unknown>;
  } catch (error) {
    throw mapGcloudError(error, `Failed to read ${label}.`);
  }
}

async function readJsonArrayOrInaccessible(
  executor: ProjectAuditExecutor,
  args: string[],
  label: string,
): Promise<{ rows: Array<Record<string, unknown>>; inaccessible: string[] }> {
  try {
    const { stdout } = await executor(args);
    const parsed = JSON.parse(stdout || "[]") as Array<Record<string, unknown>>;
    return { rows: parsed, inaccessible: [] };
  } catch {
    return { rows: [], inaccessible: [label] };
  }
}

function normalizeProjectId(projectId: string): string {
  const trimmed = projectId.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(trimmed)) {
    throw new ValidationError("A valid project ID is required.");
  }
  return trimmed;
}

function parseParent(value: unknown): ProjectAudit["parent"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const parent = value as Record<string, unknown>;
  return {
    type: stringValue(parent.type),
    id: stringValue(parent.id),
  };
}

function getNested(row: Record<string, unknown>, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, row);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function mapGcloudError(error: unknown, message: string): OmgError {
  if (error instanceof OmgError) {
    return error;
  }

  const text = getErrorText(error).toLowerCase();
  if (
    text.includes("not authenticated")
    || text.includes("application default credentials")
    || text.includes("no active account")
  ) {
    return new AuthError("gcloud is not authenticated.", "NO_AUTH");
  }

  const cliError = error as ExecFileException & { stderr?: string; exitCode?: number };
  return new CliRunnerError(
    message,
    typeof cliError.code === "number" ? cliError.code : cliError.exitCode ?? 1,
    getErrorText(error),
  );
}

function getErrorText(error: unknown): string {
  const cliError = error as Error & { stderr?: string };
  return `${cliError.stderr ?? cliError.message ?? ""}`.trim();
}
