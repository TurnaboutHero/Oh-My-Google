import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getCostLock,
  getCostLockStatus,
  lockCost,
  unlockCost,
} from "../src/cost-lock/state.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("cost lock state", () => {
  it("reports unlocked status when no local lock file exists", async () => {
    const cwd = await createTempWorkspace();

    await expect(getCostLockStatus(cwd, "demo-project")).resolves.toMatchObject({
      projectId: "demo-project",
      locked: false,
      locks: [],
      path: ".omg/cost-lock.json",
    });
  });

  it("stores project-scoped locks in .omg/cost-lock.json", async () => {
    const cwd = await createTempWorkspace();

    const result = await lockCost(cwd, {
      projectId: "demo-project",
      reason: "budget alert threshold exceeded",
      lockedBy: "agent",
      now: new Date("2026-04-28T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      changed: true,
      lock: {
        projectId: "demo-project",
        reason: "budget alert threshold exceeded",
        lockedAt: "2026-04-28T00:00:00.000Z",
        lockedBy: "agent",
      },
    });
    await expect(getCostLock(cwd, "demo-project")).resolves.toMatchObject(result.lock);
    await expect(getCostLockStatus(cwd)).resolves.toMatchObject({
      locked: true,
      locks: [result.lock],
    });
  });

  it("unlocks a project without deleting unrelated locks", async () => {
    const cwd = await createTempWorkspace();
    await lockCost(cwd, {
      projectId: "demo-project",
      reason: "budget alert",
    });
    await lockCost(cwd, {
      projectId: "other-project",
      reason: "manual hold",
    });

    const result = await unlockCost(cwd, { projectId: "demo-project" });

    expect(result.changed).toBe(true);
    await expect(getCostLock(cwd, "demo-project")).resolves.toBeUndefined();
    await expect(getCostLock(cwd, "other-project")).resolves.toMatchObject({
      projectId: "other-project",
      reason: "manual hold",
    });
  });

  it("validates project IDs and reasons", async () => {
    const cwd = await createTempWorkspace();

    await expect(lockCost(cwd, { projectId: "BAD_PROJECT", reason: "budget alert" }))
      .rejects
      .toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(lockCost(cwd, { projectId: "demo-project", reason: " " }))
      .rejects
      .toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("reports invalid local lock JSON as a validation error", async () => {
    const cwd = await createTempWorkspace();
    await fs.mkdir(path.join(cwd, ".omg"), { recursive: true });
    await fs.writeFile(path.join(cwd, ".omg", "cost-lock.json"), "{not-json", "utf-8");

    await expect(getCostLockStatus(cwd, "demo-project"))
      .rejects
      .toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Cost lock file is not valid JSON.",
      });
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-cost-lock-"));
  tempDirs.push(dir);
  return dir;
}
