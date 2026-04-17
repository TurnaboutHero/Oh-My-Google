import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const DECISION_LOG_PATH = ".omg/decisions.log.jsonl";

export type DecisionStatus = "success" | "failure" | "blocked" | "pending_approval";

export interface DecisionEvent {
  timestamp: string;
  runId: string;
  command: string;
  phase: string;
  status: DecisionStatus;
  action?: string;
  projectId?: string;
  environment?: string;
  trustAction?: string;
  reasonCode?: string;
  approvalId?: string;
  inputs?: unknown;
  result?: unknown;
  artifacts?: Record<string, string>;
  next?: string[];
}

export type DecisionEventInput = Omit<DecisionEvent, "timestamp"> & {
  timestamp?: string;
};

export function createRunId(command: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const suffix = crypto.randomBytes(3).toString("hex");
  return `run_${command}_${stamp}_${suffix}`;
}

export async function appendDecision(
  cwd: string,
  event: DecisionEventInput,
): Promise<DecisionEvent> {
  const fullEvent: DecisionEvent = {
    timestamp: event.timestamp ?? new Date().toISOString(),
    ...event,
  };
  const filePath = path.join(cwd, DECISION_LOG_PATH);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(redact(fullEvent))}\n`, {
    encoding: "utf-8",
    flag: "a",
  });
  return fullEvent;
}

export async function tryAppendDecision(
  cwd: string,
  event: DecisionEventInput,
): Promise<void> {
  try {
    await appendDecision(cwd, event);
  } catch {
    // Decision logging must not mask the command result in Phase 2.5.
  }
}

export async function readDecisionLog(cwd: string): Promise<DecisionEvent[]> {
  try {
    const raw = await fs.readFile(path.join(cwd, DECISION_LOG_PATH), "utf-8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DecisionEvent);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function redact(value: unknown, parentKey = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, parentKey));
  }

  if (!value || typeof value !== "object") {
    return shouldRedactKey(parentKey) ? "[REDACTED]" : value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = shouldRedactKey(key) || isEnvPayloadKey(key) || isEnvPayloadKey(parentKey)
      ? "[REDACTED]"
      : redact(entry, key);
  }
  return output;
}

function shouldRedactKey(key: string): boolean {
  return /secret|token|password|credential|privatekey|apikey/i.test(key);
}

function isEnvPayloadKey(key: string): boolean {
  return /^(env|envvars|environmentvariables|backendenv|frontendenv)$/i.test(key);
}
