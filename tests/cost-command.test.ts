import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runCostLock,
  runCostStatus,
  runCostUnlock,
} from "../src/cli/commands/cost.js";
import { readDecisionLog } from "../src/harness/decision-log.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("cost command", () => {
  it("reports status, locks, and unlocks local cost-bearing execution", async () => {
    const cwd = await createTempWorkspace();

    await expect(runCostStatus({ cwd, project: "demo-project" })).resolves.toMatchObject({
      ok: true,
      data: {
        locked: false,
        locks: [],
      },
    });

    const locked = await runCostLock({
      cwd,
      project: "demo-project",
      reason: "budget alert threshold exceeded",
      lockedBy: "agent",
    });

    expect(locked).toMatchObject({
      ok: true,
      data: {
        locked: true,
        changed: true,
        lock: {
          projectId: "demo-project",
          reason: "budget alert threshold exceeded",
          lockedBy: "agent",
        },
      },
    });

    const unlockWithoutConfirmation = await runCostUnlock({ cwd, project: "demo-project" });
    expect(unlockWithoutConfirmation).toMatchObject({
      ok: false,
      error: {
        code: "TRUST_REQUIRES_CONFIRM",
      },
    });

    const unlocked = await runCostUnlock({ cwd, project: "demo-project", yes: true });
    expect(unlocked).toMatchObject({
      ok: true,
      data: {
        locked: false,
        changed: true,
      },
    });

    const log = await readDecisionLog(cwd);
    expect(log.map((entry) => entry.command)).toEqual(["cost:lock", "cost:unlock"]);
  });

  it("validates command inputs", async () => {
    const cwd = await createTempWorkspace();

    await expect(runCostLock({ cwd, project: "BAD_PROJECT", reason: "budget alert" }))
      .resolves
      .toMatchObject({
        ok: false,
        error: { code: "VALIDATION_ERROR" },
      });
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-cost-command-"));
  tempDirs.push(dir);
  return dir;
}
