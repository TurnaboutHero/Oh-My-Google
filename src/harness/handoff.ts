import fs from "node:fs/promises";
import path from "node:path";

export const HANDOFF_PATH = ".omg/handoff.md";

export interface HandoffInput {
  generatedAt?: string;
  runId: string;
  command: string;
  status: "success" | "failure" | "pending_approval" | "blocked";
  projectId?: string;
  environment?: string;
  urls?: {
    backend?: string;
    frontend?: string;
  };
  pending?: string[];
  risks?: string[];
  rollback?: string[];
  next?: string[];
}

export async function writeHandoff(cwd: string, input: HandoffInput): Promise<void> {
  const filePath = path.join(cwd, HANDOFF_PATH);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, renderHandoff(input), "utf-8");
}

export async function tryWriteHandoff(cwd: string, input: HandoffInput): Promise<void> {
  try {
    await writeHandoff(cwd, input);
  } catch {
    // Handoff generation must not mask the deploy result in Phase 2.5.
  }
}

export function renderHandoff(input: HandoffInput): string {
  const lines = [
    "# omg handoff",
    "",
    `Generated: ${input.generatedAt ?? new Date().toISOString()}`,
    `Run: ${input.runId}`,
    `Command: ${input.command}`,
    `Status: ${input.status}`,
    `Project: ${input.projectId ?? "unknown"}`,
    `Environment: ${input.environment ?? "unknown"}`,
    "",
    "## URLs",
    ...listOrNone([
      input.urls?.backend ? `backend: ${input.urls.backend}` : undefined,
      input.urls?.frontend ? `frontend: ${input.urls.frontend}` : undefined,
    ]),
    "",
    "## Pending",
    ...listOrNone(input.pending),
    "",
    "## Risks",
    ...listOrNone(input.risks),
    "",
    "## Rollback",
    ...listOrNone(input.rollback),
    "",
    "## Next",
    ...listOrNone(input.next),
    "",
  ];

  return `${lines.join("\n")}`;
}

function listOrNone(items: Array<string | undefined> | undefined): string[] {
  const clean = (items ?? []).filter((item): item is string => !!item);
  if (clean.length === 0) {
    return ["- none"];
  }
  return clean.map((item) => `- ${item}`);
}
