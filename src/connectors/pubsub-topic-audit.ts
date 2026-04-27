import type { ExecFileException } from "node:child_process";
import { execCliFile } from "../system/cli-runner.js";
import { AuthError, CliRunnerError, OmgError, ValidationError } from "../types/errors.js";

export type PubsubTopicRisk = "low" | "missing_topic" | "missing_publisher" | "review";
export type PubsubTopicStatus = "visible" | "missing" | "inaccessible";
export type PubsubTopicIamStatus = "visible" | "inaccessible" | "not_checked";
export type PubsubPublisherBindingStatus = "present" | "missing" | "not_checked";

export interface PubsubTopicResource {
  projectId: string;
  topicId: string;
  name: string;
}

export interface PubsubTopicIamBindingSummary {
  role: string;
  members: string[];
  memberCount: number;
}

export interface PubsubTopicAudit {
  projectId: string;
  topicId: string;
  name: string;
  topicStatus: PubsubTopicStatus;
  iamStatus: PubsubTopicIamStatus;
  publisherBindingStatus: PubsubPublisherBindingStatus;
  publisherMembers: string[];
  bindings: PubsubTopicIamBindingSummary[];
  inaccessible: string[];
  signals: string[];
  risk: PubsubTopicRisk;
  recommendedAction: string;
}

export type PubsubTopicAuditExecutor = (
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const PUBSUB_PUBLISHER_ROLE = "roles/pubsub.publisher";

export async function auditPubsubTopic(
  topic: string,
  executor: PubsubTopicAuditExecutor = runGcloud,
): Promise<PubsubTopicAudit> {
  const resource = parsePubsubTopicResource(topic);
  const topicResult = await readTopic(executor, resource);
  if (topicResult.status !== "visible") {
    return classifyAudit({
      ...baseAudit(resource),
      topicStatus: topicResult.status,
      inaccessible: topicResult.status === "inaccessible" ? [`pubsub topic:${resource.name}`] : [],
    });
  }

  const iamResult = await readTopicIam(executor, resource);
  return classifyAudit({
    ...baseAudit(resource),
    topicStatus: "visible",
    iamStatus: iamResult.status,
    publisherBindingStatus: iamResult.status === "visible" ? getPublisherBindingStatus(iamResult.bindings) : "not_checked",
    publisherMembers: getPublisherMembers(iamResult.bindings),
    bindings: iamResult.bindings,
    inaccessible: iamResult.status === "inaccessible" ? [`pubsub topic iam:${resource.name}`] : [],
  });
}

export function parsePubsubTopicResource(topic: string): PubsubTopicResource {
  const normalized = topic.trim();
  const match = /^projects\/([a-z][a-z0-9-]{4,28}[a-z0-9])\/topics\/([A-Za-z][A-Za-z0-9._~+%-]{2,254})$/.exec(normalized);
  if (!match) {
    throw new ValidationError("Pub/Sub topic must use projects/{projectId}/topics/{topicId}.");
  }
  return {
    projectId: match[1],
    topicId: match[2],
    name: normalized,
  };
}

function baseAudit(resource: PubsubTopicResource): PubsubTopicAudit {
  return {
    projectId: resource.projectId,
    topicId: resource.topicId,
    name: resource.name,
    topicStatus: "inaccessible",
    iamStatus: "not_checked",
    publisherBindingStatus: "not_checked",
    publisherMembers: [],
    bindings: [],
    inaccessible: [],
    signals: [],
    risk: "review",
    recommendedAction: "",
  };
}

async function readTopic(
  executor: PubsubTopicAuditExecutor,
  resource: PubsubTopicResource,
): Promise<{ status: PubsubTopicStatus }> {
  try {
    await readJsonObject(
      executor,
      ["pubsub", "topics", "describe", resource.topicId, `--project=${resource.projectId}`, "--format=json"],
      `Pub/Sub topic ${resource.name}`,
    );
    return { status: "visible" };
  } catch (error) {
    const mapped = mapGcloudError(error, `Failed to read Pub/Sub topic ${resource.name}.`);
    if (mapped.code === "NO_AUTH") {
      throw mapped;
    }
    return { status: isNotFoundError(error) ? "missing" : "inaccessible" };
  }
}

async function readTopicIam(
  executor: PubsubTopicAuditExecutor,
  resource: PubsubTopicResource,
): Promise<{ status: PubsubTopicIamStatus; bindings: PubsubTopicIamBindingSummary[] }> {
  try {
    const policy = await readJsonObject(
      executor,
      ["pubsub", "topics", "get-iam-policy", resource.topicId, `--project=${resource.projectId}`, "--format=json"],
      `Pub/Sub topic IAM policy ${resource.name}`,
    );
    return {
      status: "visible",
      bindings: summarizeBindings(policy),
    };
  } catch (error) {
    const mapped = mapGcloudError(error, `Failed to read Pub/Sub topic IAM policy ${resource.name}.`);
    if (mapped.code === "NO_AUTH") {
      throw mapped;
    }
    return {
      status: "inaccessible",
      bindings: [],
    };
  }
}

function classifyAudit(audit: PubsubTopicAudit): PubsubTopicAudit {
  const signals: string[] = [];
  if (audit.topicStatus === "visible") {
    signals.push(`Pub/Sub topic is visible: ${audit.name}.`);
  }
  if (audit.topicStatus === "missing") {
    signals.push(`Pub/Sub topic does not exist or is not visible: ${audit.name}.`);
  }
  if (audit.iamStatus === "visible" && audit.publisherBindingStatus === "present") {
    signals.push(`Pub/Sub Publisher binding is visible on ${audit.name}.`);
  }
  if (audit.iamStatus === "visible" && audit.publisherBindingStatus === "missing") {
    signals.push(`No Pub/Sub Publisher binding is visible on ${audit.name}.`);
  }
  for (const label of audit.inaccessible) {
    signals.push(`Pub/Sub audit could not inspect ${label}.`);
  }

  const risk = getRisk(audit);
  return {
    ...audit,
    signals,
    risk,
    recommendedAction: getRecommendedAction(risk),
  };
}

function getRisk(audit: PubsubTopicAudit): PubsubTopicRisk {
  if (audit.topicStatus === "missing") {
    return "missing_topic";
  }
  if (audit.topicStatus === "inaccessible" || audit.iamStatus === "inaccessible") {
    return "review";
  }
  if (audit.publisherBindingStatus === "missing") {
    return "missing_publisher";
  }
  return "low";
}

function getRecommendedAction(risk: PubsubTopicRisk): string {
  switch (risk) {
    case "low":
      return "Pub/Sub topic exists and a Pub/Sub Publisher binding is visible.";
    case "missing_topic":
      return "Create the Pub/Sub topic before connecting budget notifications.";
    case "missing_publisher":
      return "Review Pub/Sub Publisher permission before connecting budget notifications.";
    case "review":
      return "Review Pub/Sub topic visibility and IAM permissions before connecting budget notifications.";
  }
}

function summarizeBindings(policy: Record<string, unknown>): PubsubTopicIamBindingSummary[] {
  return recordArrayValue(policy.bindings)
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
      };
    })
    .filter((binding) => binding.role)
    .sort((a, b) => a.role.localeCompare(b.role));
}

function getPublisherBindingStatus(
  bindings: PubsubTopicIamBindingSummary[],
): PubsubPublisherBindingStatus {
  return bindings.some((binding) => binding.role === PUBSUB_PUBLISHER_ROLE && binding.members.length > 0)
    ? "present"
    : "missing";
}

function getPublisherMembers(bindings: PubsubTopicIamBindingSummary[]): string[] {
  return bindings
    .filter((binding) => binding.role === PUBSUB_PUBLISHER_ROLE)
    .flatMap((binding) => binding.members)
    .sort();
}

async function runGcloud(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execCliFile("gcloud", args, {
      encoding: "utf-8",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 10,
    });
  } catch (error) {
    throw mapGcloudError(error, "gcloud Pub/Sub topic audit command failed.");
  }
}

async function readJsonObject(
  executor: PubsubTopicAuditExecutor,
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

function isNotFoundError(error: unknown): boolean {
  const text = getErrorText(error).toLowerCase();
  return text.includes("not found") || text.includes("notfound") || text.includes("not_found");
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
