import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendDecision,
  createRunId,
  DECISION_LOG_PATH,
  readDecisionLog,
} from "../src/harness/decision-log.js";
import { HANDOFF_PATH, renderHandoff, writeHandoff } from "../src/harness/handoff.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("decision log", () => {
  it("appends jsonl events under .omg", async () => {
    const cwd = await createTempWorkspace();
    const runId = createRunId("deploy", new Date("2026-04-17T00:00:00.000Z"));

    await appendDecision(cwd, {
      runId,
      command: "deploy",
      phase: "execute",
      status: "success",
      result: { urls: { frontend: "https://demo.web.app" } },
    });

    const raw = await fs.readFile(path.join(cwd, DECISION_LOG_PATH), "utf-8");
    const events = await readDecisionLog(cwd);

    expect(runId).toMatch(/^run_deploy_20260417T000000Z_[a-f0-9]{6}$/);
    expect(raw.trim().split(/\r?\n/)).toHaveLength(1);
    expect(events[0]).toMatchObject({
      runId,
      command: "deploy",
      phase: "execute",
      status: "success",
    });
  });

  it("redacts sensitive values before writing", async () => {
    const cwd = await createTempWorkspace();

    await appendDecision(cwd, {
      runId: "run_test",
      command: "init",
      phase: "execute",
      status: "success",
      inputs: {
        apiKey: "abc",
        nested: { password: "secret" },
        backendEnv: { PUBLIC_VALUE: "not-public-in-logs" },
        regular: "visible",
      },
    });

    const raw = await fs.readFile(path.join(cwd, DECISION_LOG_PATH), "utf-8");

    expect(raw).toContain("[REDACTED]");
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("not-public-in-logs");
    expect(raw).toContain("visible");
  });
});

describe("handoff", () => {
  it("renders a concise handoff artifact", async () => {
    const cwd = await createTempWorkspace();

    await writeHandoff(cwd, {
      generatedAt: "2026-04-17T00:00:00.000Z",
      runId: "run_deploy",
      command: "deploy",
      status: "success",
      projectId: "demo-project",
      environment: "dev",
      urls: { frontend: "https://demo.web.app" },
      next: ["omg doctor"],
    });

    const handoff = await fs.readFile(path.join(cwd, HANDOFF_PATH), "utf-8");

    expect(handoff).toContain("# omg handoff");
    expect(handoff).toContain("Status: success");
    expect(handoff).toContain("- frontend: https://demo.web.app");
    expect(handoff).toContain("- omg doctor");
  });

  it("uses none markers for empty sections", () => {
    const handoff = renderHandoff({
      generatedAt: "2026-04-17T00:00:00.000Z",
      runId: "run_deploy",
      command: "deploy",
      status: "blocked",
    });

    expect(handoff).toContain("## URLs\n- none");
    expect(handoff).toContain("## Next\n- none");
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-harness-"));
  tempDirs.push(dir);
  return dir;
}
