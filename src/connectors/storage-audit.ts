import type { ExecFileException } from "node:child_process";
import { execCliFile } from "../system/cli-runner.js";
import { AuthError, CliRunnerError, OmgError, ValidationError } from "../types/errors.js";

export type StorageAuditRisk = "low" | "review" | "high";
export type StorageFindingSeverity = "review" | "high";

export interface StorageBucketSummary {
  name: string;
  url: string;
  location?: string;
  storageClass?: string;
  uniformBucketLevelAccess?: boolean;
  publicAccessPrevention?: string;
  retentionPolicyLocked?: boolean;
  versioningEnabled?: boolean;
  lifecycleRuleCount: number;
}

export interface StorageIamBindingSummary {
  bucket: string;
  role: string;
  members: string[];
  memberCount: number;
  public: boolean;
}

export interface StorageFinding {
  severity: StorageFindingSeverity;
  reason: string;
  bucket?: string;
  role?: string;
  member?: string;
}

export interface StorageAudit {
  projectId: string;
  buckets: StorageBucketSummary[];
  iamBindings: StorageIamBindingSummary[];
  findings: StorageFinding[];
  inaccessible: string[];
  signals: string[];
  risk: StorageAuditRisk;
  recommendedAction: string;
}

export type StorageAuditExecutor = (
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const PUBLIC_MEMBERS = new Set(["allUsers", "allAuthenticatedUsers"]);

export async function auditStorage(
  projectId: string,
  executor: StorageAuditExecutor = runGcloud,
): Promise<StorageAudit> {
  const normalizedProjectId = normalizeProjectId(projectId);
  const bucketRows = await readJsonArray(
    executor,
    ["storage", "buckets", "list", `--project=${normalizedProjectId}`, "--raw", "--format=json"],
    "Cloud Storage buckets",
  );
  const buckets = bucketRows.map(parseBucket).filter((bucket) => bucket.name).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const iamResults = await Promise.all(
    buckets.map((bucket) => readBucketIam(executor, normalizedProjectId, bucket.name)),
  );
  const iamBindings = iamResults.flatMap((result) => result.bindings);
  const inaccessible = iamResults.flatMap((result) => result.inaccessible);

  return classifyAudit({
    projectId: normalizedProjectId,
    buckets,
    iamBindings,
    findings: [],
    inaccessible,
    signals: [],
    risk: "low",
    recommendedAction: "",
  });
}

async function readBucketIam(
  executor: StorageAuditExecutor,
  projectId: string,
  bucketName: string,
): Promise<{ bindings: StorageIamBindingSummary[]; inaccessible: string[] }> {
  try {
    const policy = await readJsonObject(
      executor,
      [
        "storage",
        "buckets",
        "get-iam-policy",
        `gs://${bucketName}`,
        `--project=${projectId}`,
        "--format=json",
      ],
      `Cloud Storage IAM policy for bucket ${bucketName}`,
    );
    return {
      bindings: summarizeBindings(policy, bucketName),
      inaccessible: [],
    };
  } catch (error) {
    const mapped = mapGcloudError(error, `Failed to read Cloud Storage IAM policy for bucket ${bucketName}.`);
    if (mapped.code === "NO_AUTH") {
      throw mapped;
    }
    return { bindings: [], inaccessible: [`bucket iam:${bucketName}`] };
  }
}

function classifyAudit(audit: StorageAudit): StorageAudit {
  const findings: StorageFinding[] = [];
  const signals: string[] = [];

  if (audit.buckets.length > 0) {
    signals.push(`${audit.buckets.length} Cloud Storage bucket(s) visible.`);
  }

  for (const bucket of audit.buckets) {
    if (bucket.publicAccessPrevention && bucket.publicAccessPrevention !== "enforced") {
      signals.push(`Public access prevention is not enforced for Cloud Storage bucket ${bucket.name}.`);
    }
    if (bucket.uniformBucketLevelAccess === false) {
      signals.push(`Uniform bucket-level access is disabled for Cloud Storage bucket ${bucket.name}.`);
    }
  }

  for (const binding of audit.iamBindings) {
    for (const member of binding.members) {
      if (PUBLIC_MEMBERS.has(member)) {
        findings.push({
          severity: "high",
          reason: "Public principal has a Cloud Storage bucket IAM binding.",
          bucket: binding.bucket,
          role: binding.role,
          member,
        });
      }
    }
  }

  for (const finding of findings) {
    signals.push(formatFindingSignal(finding));
  }
  for (const label of audit.inaccessible) {
    signals.push(`Cloud Storage audit could not inspect ${label}.`);
  }

  const risk: StorageAuditRisk = findings.some((finding) => finding.severity === "high")
    ? "high"
    : signals.length > 0 || audit.inaccessible.length > 0
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

function parseBucket(row: Record<string, unknown>): StorageBucketSummary {
  const iamConfiguration = recordValue(row.iamConfiguration);
  const uniformBucketLevelAccess = recordValue(iamConfiguration?.uniformBucketLevelAccess);
  const bucketPolicyOnly = recordValue(iamConfiguration?.bucketPolicyOnly);
  const retentionPolicy = recordValue(row.retentionPolicy);
  const versioning = recordValue(row.versioning);
  const lifecycle = recordValue(row.lifecycle);
  const name = bucketNameFromValue(row.name) || bucketNameFromValue(row.id) || bucketNameFromValue(row.url);

  return {
    name,
    url: name ? `gs://${name}` : stringValue(row.url),
    location: optionalStringValue(row.location),
    storageClass: optionalStringValue(row.storageClass) ?? optionalStringValue(row.default_storage_class),
    uniformBucketLevelAccess: optionalBooleanValue(uniformBucketLevelAccess?.enabled)
      ?? optionalBooleanValue(bucketPolicyOnly?.enabled)
      ?? optionalBooleanValue(row.uniformBucketLevelAccess)
      ?? optionalBooleanValue(row.uniform_bucket_level_access),
    publicAccessPrevention: optionalStringValue(iamConfiguration?.publicAccessPrevention)
      ?? optionalStringValue(row.publicAccessPrevention)
      ?? optionalStringValue(row.public_access_prevention),
    retentionPolicyLocked: optionalBooleanValue(retentionPolicy?.isLocked),
    versioningEnabled: optionalBooleanValue(versioning?.enabled),
    lifecycleRuleCount: recordArrayValue(lifecycle?.rule).length,
  };
}

function summarizeBindings(policy: Record<string, unknown>, bucketName: string): StorageIamBindingSummary[] {
  return recordArrayValue(policy.bindings)
    .map((row) => {
      const role = stringValue(row.role);
      const members = arrayValue(row.members)
        .map((member) => stringValue(member))
        .filter(Boolean)
        .sort();
      return {
        bucket: bucketName,
        role,
        members,
        memberCount: members.length,
        public: members.some((member) => PUBLIC_MEMBERS.has(member)),
      };
    })
    .filter((binding) => binding.role)
    .sort((a, b) => a.bucket.localeCompare(b.bucket) || a.role.localeCompare(b.role));
}

async function runGcloud(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execCliFile("gcloud", args, {
      encoding: "utf-8",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 10,
    });
  } catch (error) {
    throw mapGcloudError(error, "gcloud Cloud Storage audit command failed.");
  }
}

async function readJsonArray(
  executor: StorageAuditExecutor,
  args: string[],
  label: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    const { stdout } = await executor(args);
    return JSON.parse(stdout || "[]") as Array<Record<string, unknown>>;
  } catch (error) {
    throw mapGcloudError(error, `Failed to list ${label}.`);
  }
}

async function readJsonObject(
  executor: StorageAuditExecutor,
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

function normalizeProjectId(projectId: string): string {
  const trimmed = projectId.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(trimmed)) {
    throw new ValidationError("A valid project ID is required.");
  }
  return trimmed;
}

function bucketNameFromValue(value: unknown): string {
  const parsed = stringValue(value).replace(/^gs:\/\//, "");
  return parsed.replace(/\/$/, "");
}

function formatFindingSignal(finding: StorageFinding): string {
  const bucket = finding.bucket ? ` Bucket: ${finding.bucket}.` : "";
  const role = finding.role ? ` Role: ${finding.role}.` : "";
  const member = finding.member ? ` Member: ${finding.member}.` : "";
  return `${finding.reason}${bucket}${role}${member}`;
}

function getRecommendedAction(risk: StorageAuditRisk): string {
  if (risk === "high") {
    return "Review public Cloud Storage IAM bindings before adding bucket, object, or lifecycle write workflows.";
  }
  if (risk === "review") {
    return "Review Cloud Storage buckets before adding bucket, object, IAM, or lifecycle mutation workflows.";
  }
  return "No Cloud Storage buckets were visible.";
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
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
