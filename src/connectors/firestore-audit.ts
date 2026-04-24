import type { ExecFileException } from "node:child_process";
import { execCliFile } from "../system/cli-runner.js";
import { AuthError, CliRunnerError, OmgError, ValidationError } from "../types/errors.js";

export type FirestoreAuditRisk = "low" | "review";

export interface FirestoreDatabaseSummary {
  name: string;
  databaseId: string;
  locationId?: string;
  type?: string;
  concurrencyMode?: string;
  appEngineIntegrationMode?: string;
  pointInTimeRecoveryEnablement?: string;
  deleteProtectionState?: string;
}

export interface FirestoreCompositeIndexSummary {
  name: string;
  databaseId: string;
  collectionGroup?: string;
  queryScope?: string;
  state?: string;
  fieldCount: number;
}

export interface FirestoreAudit {
  projectId: string;
  databases: FirestoreDatabaseSummary[];
  compositeIndexes: FirestoreCompositeIndexSummary[];
  inaccessible: string[];
  signals: string[];
  risk: FirestoreAuditRisk;
  recommendedAction: string;
}

export type FirestoreAuditExecutor = (
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export async function auditFirestore(
  projectId: string,
  executor: FirestoreAuditExecutor = runGcloud,
): Promise<FirestoreAudit> {
  const normalizedProjectId = normalizeProjectId(projectId);
  const databaseRows = await readJsonArray(
    executor,
    ["firestore", "databases", "list", `--project=${normalizedProjectId}`, "--format=json"],
    "Firestore databases",
  );
  const databases = databaseRows.map(parseDatabase).sort((a, b) => a.databaseId.localeCompare(b.databaseId));
  const indexResults = await Promise.all(
    databases.map((database) => readCompositeIndexes(executor, normalizedProjectId, database.databaseId)),
  );
  const compositeIndexes = indexResults.flatMap((result) => result.indexes);
  const inaccessible = indexResults.flatMap((result) => result.inaccessible);
  const signals = buildSignals(databases, compositeIndexes, inaccessible);
  const risk: FirestoreAuditRisk = signals.length > 0 ? "review" : "low";

  return {
    projectId: normalizedProjectId,
    databases,
    compositeIndexes,
    inaccessible,
    signals,
    risk,
    recommendedAction: getRecommendedAction(risk),
  };
}

async function readCompositeIndexes(
  executor: FirestoreAuditExecutor,
  projectId: string,
  databaseId: string,
): Promise<{ indexes: FirestoreCompositeIndexSummary[]; inaccessible: string[] }> {
  try {
    const rows = await readJsonArray(
      executor,
      [
        "firestore",
        "indexes",
        "composite",
        "list",
        `--project=${projectId}`,
        `--database=${databaseId}`,
        "--format=json",
      ],
      `Firestore composite indexes for database ${databaseId}`,
    );
    return {
      indexes: rows.map((row) => parseCompositeIndex(row, databaseId)).sort((a, b) => a.name.localeCompare(b.name)),
      inaccessible: [],
    };
  } catch (error) {
    const mapped = mapGcloudError(error, `Failed to list Firestore indexes for database ${databaseId}.`);
    if (mapped.code === "NO_AUTH") {
      throw mapped;
    }
    return { indexes: [], inaccessible: [`composite indexes:${databaseId}`] };
  }
}

function parseDatabase(row: Record<string, unknown>): FirestoreDatabaseSummary {
  const name = stringValue(row.name);
  return {
    name,
    databaseId: databaseIdFromName(name) || stringValue(row.databaseId) || "(default)",
    locationId: optionalStringValue(row.locationId),
    type: optionalStringValue(row.type),
    concurrencyMode: optionalStringValue(row.concurrencyMode),
    appEngineIntegrationMode: optionalStringValue(row.appEngineIntegrationMode),
    pointInTimeRecoveryEnablement: optionalStringValue(row.pointInTimeRecoveryEnablement),
    deleteProtectionState: optionalStringValue(row.deleteProtectionState),
  };
}

function parseCompositeIndex(
  row: Record<string, unknown>,
  databaseId: string,
): FirestoreCompositeIndexSummary {
  return {
    name: stringValue(row.name),
    databaseId,
    collectionGroup: optionalStringValue(row.collectionGroup),
    queryScope: optionalStringValue(row.queryScope),
    state: optionalStringValue(row.state),
    fieldCount: arrayValue(row.fields).length,
  };
}

function buildSignals(
  databases: FirestoreDatabaseSummary[],
  indexes: FirestoreCompositeIndexSummary[],
  inaccessible: string[],
): string[] {
  const signals: string[] = [];
  if (databases.length > 0) {
    signals.push(`${databases.length} Firestore database(s) visible.`);
  }
  for (const database of databases) {
    if (database.deleteProtectionState === "DELETE_PROTECTION_DISABLED") {
      signals.push(`Delete protection is disabled for Firestore database ${database.databaseId}.`);
    }
    if (database.pointInTimeRecoveryEnablement === "POINT_IN_TIME_RECOVERY_DISABLED") {
      signals.push(`Point-in-time recovery is disabled for Firestore database ${database.databaseId}.`);
    }
  }
  if (indexes.length > 0) {
    signals.push(`${indexes.length} Firestore composite index(es) visible.`);
  }
  for (const label of inaccessible) {
    signals.push(`Firestore audit could not inspect ${label}.`);
  }
  return signals;
}

async function runGcloud(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execCliFile("gcloud", args, {
      encoding: "utf-8",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 10,
    });
  } catch (error) {
    throw mapGcloudError(error, "gcloud Firestore audit command failed.");
  }
}

async function readJsonArray(
  executor: FirestoreAuditExecutor,
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

function databaseIdFromName(name: string): string | undefined {
  const match = name.match(/\/databases\/([^/]+)$/);
  return match?.[1];
}

function getRecommendedAction(risk: FirestoreAuditRisk): string {
  if (risk === "review") {
    return "Review Firestore databases before adding create, delete, export, import, or data mutation workflows.";
  }
  return "No Firestore databases were visible.";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalStringValue(value: unknown): string | undefined {
  const parsed = stringValue(value);
  return parsed || undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
