import type { ExecFileException } from "node:child_process";
import { execCliFile } from "../system/cli-runner.js";
import { AuthError, CliRunnerError, OmgError, ValidationError } from "../types/errors.js";

export type IamAuditRisk = "low" | "review" | "high";
export type IamFindingSeverity = "review" | "high";

export interface IamBindingSummary {
  role: string;
  members: string[];
  memberCount: number;
  public: boolean;
  primitive: boolean;
}

export interface IamServiceAccountSummary {
  email: string;
  displayName?: string;
  disabled?: boolean;
  uniqueId?: string;
}

export interface IamFinding {
  severity: IamFindingSeverity;
  reason: string;
  role?: string;
  member?: string;
}

export interface IamAudit {
  projectId: string;
  bindings: IamBindingSummary[];
  serviceAccounts: IamServiceAccountSummary[];
  findings: IamFinding[];
  inaccessible: string[];
  signals: string[];
  risk: IamAuditRisk;
  recommendedAction: string;
}

export type IamAuditExecutor = (
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const PRIMITIVE_ROLES = new Set(["roles/owner", "roles/editor"]);
const REVIEW_ROLES = new Set([
  "roles/iam.serviceAccountUser",
  "roles/resourcemanager.projectIamAdmin",
]);
const HIGH_IMPACT_ROLES = new Set([
  "roles/iam.securityAdmin",
  "roles/iam.serviceAccountKeyAdmin",
  "roles/iam.serviceAccountTokenCreator",
]);
const PUBLIC_MEMBERS = new Set(["allUsers", "allAuthenticatedUsers"]);

export async function auditIam(
  projectId: string,
  executor: IamAuditExecutor = runGcloud,
): Promise<IamAudit> {
  const normalizedProjectId = normalizeProjectId(projectId);
  const policyResult = await readJsonObjectOrInaccessible(
    executor,
    ["projects", "get-iam-policy", normalizedProjectId, "--format=json"],
    "iam policy",
  );
  const serviceAccountsResult = await readJsonArrayOrInaccessible(
    executor,
    ["iam", "service-accounts", "list", `--project=${normalizedProjectId}`, "--format=json"],
    "service accounts",
  );

  const audit: IamAudit = {
    projectId: normalizedProjectId,
    bindings: summarizeBindings(policyResult.value),
    serviceAccounts: summarizeServiceAccounts(serviceAccountsResult.rows),
    findings: [],
    inaccessible: [
      ...policyResult.inaccessible,
      ...serviceAccountsResult.inaccessible,
    ],
    signals: [],
    risk: "low",
    recommendedAction: "",
  };

  return classifyAudit(audit);
}

function classifyAudit(audit: IamAudit): IamAudit {
  const findings: IamFinding[] = [];
  const signals: string[] = [];

  if (audit.inaccessible.includes("iam policy")) {
    findings.push({
      severity: "high",
      reason: "Caller does not have IAM policy visibility.",
    });
  }

  for (const binding of audit.bindings) {
    for (const member of binding.members) {
      if (PUBLIC_MEMBERS.has(member)) {
        findings.push({
          severity: "high",
          reason: "Public principal has an IAM binding.",
          role: binding.role,
          member,
        });
      }
    }

    if (binding.primitive) {
      findings.push({
        severity: "review",
        reason: "Primitive project role should be reviewed before adding IAM automation.",
        role: binding.role,
      });
    }

    if (HIGH_IMPACT_ROLES.has(binding.role)) {
      findings.push({
        severity: "review",
        reason: "High-impact IAM administration role is present.",
        role: binding.role,
      });
    } else if (REVIEW_ROLES.has(binding.role)) {
      findings.push({
        severity: "review",
        reason: "IAM administration or service account impersonation role is present.",
        role: binding.role,
      });
    }
  }

  if (audit.serviceAccounts.length > 0) {
    signals.push(`${audit.serviceAccounts.length} service account(s) visible.`);
  }
  for (const account of audit.serviceAccounts.filter((entry) => entry.disabled)) {
    signals.push(`Disabled service account visible: ${account.email}.`);
  }
  for (const finding of findings) {
    signals.push(formatFindingSignal(finding));
  }

  const risk: IamAuditRisk = findings.some((finding) => finding.severity === "high")
    ? "high"
    : findings.length > 0 || audit.inaccessible.length > 0
      ? "review"
      : "low";

  return {
    ...audit,
    findings,
    signals,
    risk,
    recommendedAction: getRecommendedAction(risk),
  };
}

function summarizeBindings(policy: Record<string, unknown> | undefined): IamBindingSummary[] {
  const rows = recordArrayValue(policy?.bindings);
  return rows
    .map((row) => {
      const role = stringValue(row.role);
      const members = arrayValue(row.members)
        .map((member) => stringValue(member))
        .filter(Boolean)
        .sort();
      return {
        role,
        members,
        memberCount: members.length,
        public: members.some((member) => PUBLIC_MEMBERS.has(member)),
        primitive: PRIMITIVE_ROLES.has(role),
      };
    })
    .filter((binding) => binding.role)
    .sort((a, b) => a.role.localeCompare(b.role));
}

function summarizeServiceAccounts(rows: Array<Record<string, unknown>>): IamServiceAccountSummary[] {
  return rows
    .map((row) => ({
      email: stringValue(row.email),
      displayName: optionalStringValue(row.displayName),
      disabled: optionalBooleanValue(row.disabled),
      uniqueId: optionalStringValue(row.uniqueId),
    }))
    .filter((account) => account.email)
    .sort((a, b) => a.email.localeCompare(b.email));
}

async function runGcloud(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execCliFile("gcloud", args, {
      encoding: "utf-8",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 10,
    });
  } catch (error) {
    throw mapGcloudError(error, "gcloud IAM audit command failed.");
  }
}

async function readJsonObjectOrInaccessible(
  executor: IamAuditExecutor,
  args: string[],
  label: string,
): Promise<{ value?: Record<string, unknown>; inaccessible: string[] }> {
  try {
    const { stdout } = await executor(args);
    return { value: JSON.parse(stdout || "{}") as Record<string, unknown>, inaccessible: [] };
  } catch (error) {
    const mapped = mapGcloudError(error, `Failed to read ${label}.`);
    if (mapped.code === "NO_AUTH") {
      throw mapped;
    }
    return { inaccessible: [label] };
  }
}

async function readJsonArrayOrInaccessible(
  executor: IamAuditExecutor,
  args: string[],
  label: string,
): Promise<{ rows: Array<Record<string, unknown>>; inaccessible: string[] }> {
  try {
    const { stdout } = await executor(args);
    return { rows: JSON.parse(stdout || "[]") as Array<Record<string, unknown>>, inaccessible: [] };
  } catch (error) {
    const mapped = mapGcloudError(error, `Failed to read ${label}.`);
    if (mapped.code === "NO_AUTH") {
      throw mapped;
    }
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

function formatFindingSignal(finding: IamFinding): string {
  const role = finding.role ? ` Role: ${finding.role}.` : "";
  const member = finding.member ? ` Member: ${finding.member}.` : "";
  return `${finding.reason}${role}${member}`;
}

function getRecommendedAction(risk: IamAuditRisk): string {
  if (risk === "high") {
    return "Review IAM policy manually before enabling any IAM write automation.";
  }
  if (risk === "review") {
    return "Review privileged IAM bindings and service accounts before adding IAM writes.";
  }
  return "No broad IAM risk signals were detected.";
}

function recordArrayValue(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is Record<string, unknown> =>
    typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalStringValue(value: unknown): string | undefined {
  const parsed = stringValue(value);
  return parsed || undefined;
}

function optionalBooleanValue(value: unknown): boolean | undefined {
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
