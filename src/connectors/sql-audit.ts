import type { ExecFileException } from "node:child_process";
import { execCliFile } from "../system/cli-runner.js";
import { AuthError, CliRunnerError, OmgError, ValidationError } from "../types/errors.js";

export type SqlAuditRisk = "low" | "review" | "high";
export type SqlFindingSeverity = "review" | "high";

export interface SqlInstanceSummary {
  name: string;
  databaseVersion?: string;
  region?: string;
  state?: string;
  availabilityType?: string;
  backupEnabled?: boolean;
  pointInTimeRecoveryEnabled?: boolean;
  binaryLogEnabled?: boolean;
  ipv4Enabled?: boolean;
  authorizedNetworks: string[];
  deletionProtectionEnabled?: boolean;
}

export interface SqlBackupSummary {
  instance: string;
  id: string;
  status?: string;
  type?: string;
  windowStartTime?: string;
  endTime?: string;
}

export interface SqlFinding {
  severity: SqlFindingSeverity;
  reason: string;
  instance?: string;
  network?: string;
}

export interface SqlAudit {
  projectId: string;
  instances: SqlInstanceSummary[];
  backups: SqlBackupSummary[];
  findings: SqlFinding[];
  inaccessible: string[];
  signals: string[];
  risk: SqlAuditRisk;
  recommendedAction: string;
}

export type SqlAuditExecutor = (
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const PUBLIC_NETWORKS = new Set(["0.0.0.0/0", "::/0"]);

export async function auditSql(
  projectId: string,
  executor: SqlAuditExecutor = runGcloud,
): Promise<SqlAudit> {
  const normalizedProjectId = normalizeProjectId(projectId);
  const instanceRows = await readJsonArray(
    executor,
    [
      "sql",
      "instances",
      "list",
      `--project=${normalizedProjectId}`,
      "--show-edition",
      "--show-sql-network-architecture",
      "--show-transactional-log-storage-state",
      "--format=json",
    ],
    "Cloud SQL instances",
  );
  const instances = instanceRows.map(parseInstance).filter((instance) => instance.name).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const backupResults = await Promise.all(
    instances.map((instance) => readBackupsForInstance(executor, normalizedProjectId, instance.name)),
  );
  const backups = backupResults.flatMap((result) => result.backups);
  const inaccessible = backupResults.flatMap((result) => result.inaccessible);

  return classifyAudit({
    projectId: normalizedProjectId,
    instances,
    backups,
    findings: [],
    inaccessible,
    signals: [],
    risk: "low",
    recommendedAction: "",
  });
}

async function readBackupsForInstance(
  executor: SqlAuditExecutor,
  projectId: string,
  instanceName: string,
): Promise<{ backups: SqlBackupSummary[]; inaccessible: string[] }> {
  try {
    const rows = await readJsonArray(
      executor,
      ["sql", "backups", "list", `--instance=${instanceName}`, `--project=${projectId}`, "--format=json"],
      `Cloud SQL backups for instance ${instanceName}`,
    );
    return {
      backups: rows.map((row) => parseBackup(row, instanceName)).sort((a, b) =>
        a.instance.localeCompare(b.instance) || a.id.localeCompare(b.id)
      ),
      inaccessible: [],
    };
  } catch (error) {
    const mapped = mapGcloudError(error, `Failed to list Cloud SQL backups for instance ${instanceName}.`);
    if (mapped.code === "NO_AUTH") {
      throw mapped;
    }
    return { backups: [], inaccessible: [`backups:${instanceName}`] };
  }
}

function classifyAudit(audit: SqlAudit): SqlAudit {
  const findings: SqlFinding[] = [];
  const signals: string[] = [];
  const backupCountByInstance = new Map<string, number>();

  for (const backup of audit.backups) {
    backupCountByInstance.set(backup.instance, (backupCountByInstance.get(backup.instance) ?? 0) + 1);
  }

  if (audit.instances.length > 0) {
    signals.push(`${audit.instances.length} Cloud SQL instance(s) visible.`);
  }

  for (const instance of audit.instances) {
    if (instance.backupEnabled === false) {
      signals.push(`Backups are disabled for Cloud SQL instance ${instance.name}.`);
    } else if (instance.backupEnabled === true && (backupCountByInstance.get(instance.name) ?? 0) === 0) {
      signals.push(`No Cloud SQL backup runs were visible for instance ${instance.name}.`);
    }

    if (instance.pointInTimeRecoveryEnabled === false) {
      signals.push(`Point-in-time recovery is disabled for Cloud SQL instance ${instance.name}.`);
    }
    if (instance.deletionProtectionEnabled === false) {
      signals.push(`Deletion protection is disabled for Cloud SQL instance ${instance.name}.`);
    }
    if (instance.ipv4Enabled === true) {
      signals.push(`Public IPv4 is enabled for Cloud SQL instance ${instance.name}.`);
    }

    for (const network of instance.authorizedNetworks) {
      if (PUBLIC_NETWORKS.has(network)) {
        findings.push({
          severity: "high",
          reason: "Cloud SQL authorized network is open to the public internet.",
          instance: instance.name,
          network,
        });
      }
    }
  }

  for (const finding of findings) {
    signals.push(formatFindingSignal(finding));
  }
  for (const label of audit.inaccessible) {
    signals.push(`Cloud SQL audit could not inspect ${label}.`);
  }

  const risk: SqlAuditRisk = findings.some((finding) => finding.severity === "high")
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

function parseInstance(row: Record<string, unknown>): SqlInstanceSummary {
  const settings = recordValue(row.settings);
  const backupConfiguration = recordValue(settings?.backupConfiguration);
  const ipConfiguration = recordValue(settings?.ipConfiguration);

  return {
    name: stringValue(row.name),
    databaseVersion: optionalStringValue(row.databaseVersion),
    region: optionalStringValue(row.region),
    state: optionalStringValue(row.state),
    availabilityType: optionalStringValue(settings?.availabilityType),
    backupEnabled: optionalBooleanValue(backupConfiguration?.enabled),
    pointInTimeRecoveryEnabled: optionalBooleanValue(backupConfiguration?.pointInTimeRecoveryEnabled),
    binaryLogEnabled: optionalBooleanValue(backupConfiguration?.binaryLogEnabled),
    ipv4Enabled: optionalBooleanValue(ipConfiguration?.ipv4Enabled),
    authorizedNetworks: recordArrayValue(ipConfiguration?.authorizedNetworks)
      .map((network) => stringValue(network.value))
      .filter(Boolean)
      .sort(),
    deletionProtectionEnabled: optionalBooleanValue(settings?.deletionProtectionEnabled)
      ?? optionalBooleanValue(row.deletionProtectionEnabled),
  };
}

function parseBackup(row: Record<string, unknown>, instanceName: string): SqlBackupSummary {
  return {
    instance: optionalStringValue(row.instance) ?? instanceName,
    id: scalarStringValue(row.id) || scalarStringValue(row.name),
    status: optionalStringValue(row.status),
    type: optionalStringValue(row.type),
    windowStartTime: optionalStringValue(row.windowStartTime),
    endTime: optionalStringValue(row.endTime),
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
    throw mapGcloudError(error, "gcloud Cloud SQL audit command failed.");
  }
}

async function readJsonArray(
  executor: SqlAuditExecutor,
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

function normalizeProjectId(projectId: string): string {
  const trimmed = projectId.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(trimmed)) {
    throw new ValidationError("A valid project ID is required.");
  }
  return trimmed;
}

function formatFindingSignal(finding: SqlFinding): string {
  const instance = finding.instance ? ` Instance: ${finding.instance}.` : "";
  const network = finding.network ? ` Network: ${finding.network}.` : "";
  return `${finding.reason}${instance}${network}`;
}

function getRecommendedAction(risk: SqlAuditRisk): string {
  if (risk === "high") {
    return "Review public Cloud SQL network exposure before adding instance, backup, export, import, or lifecycle workflows.";
  }
  if (risk === "review") {
    return "Review Cloud SQL instances before adding instance, backup, export, import, or lifecycle mutation workflows.";
  }
  return "No Cloud SQL instances were visible.";
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

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function scalarStringValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return "";
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
