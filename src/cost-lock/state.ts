import fs from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "../types/errors.js";

export const COST_LOCK_PATH = ".omg/cost-lock.json";

export interface CostLockRecord {
  projectId: string;
  reason: string;
  lockedAt: string;
  lockedBy?: string;
}

export interface CostLockFile {
  version: 1;
  locks: Record<string, CostLockRecord>;
}

export interface CostLockStatus {
  projectId?: string;
  locked: boolean;
  lock?: CostLockRecord;
  locks: CostLockRecord[];
  path: string;
}

export async function readCostLockFile(cwd: string): Promise<CostLockFile> {
  try {
    const raw = await fs.readFile(resolveCostLockPath(cwd), "utf-8");
    let parsed: Partial<CostLockFile>;
    try {
      parsed = JSON.parse(raw) as Partial<CostLockFile>;
    } catch {
      throw new ValidationError("Cost lock file is not valid JSON.");
    }
    return normalizeCostLockFile(parsed);
  } catch (error) {
    if (isNotFound(error)) {
      return emptyCostLockFile();
    }
    throw error;
  }
}

export async function getCostLock(
  cwd: string,
  projectId: string,
): Promise<CostLockRecord | undefined> {
  const normalizedProjectId = normalizeProjectId(projectId);
  const state = await readCostLockFile(cwd);
  return state.locks[normalizedProjectId];
}

export async function getCostLockStatus(
  cwd: string,
  projectId?: string,
): Promise<CostLockStatus> {
  const state = await readCostLockFile(cwd);
  const normalizedProjectId = projectId ? normalizeProjectId(projectId) : undefined;
  const locks = Object.values(state.locks).sort((a, b) => a.projectId.localeCompare(b.projectId));
  const lock = normalizedProjectId ? state.locks[normalizedProjectId] : undefined;
  return {
    projectId: normalizedProjectId,
    locked: normalizedProjectId ? !!lock : locks.length > 0,
    lock,
    locks,
    path: COST_LOCK_PATH,
  };
}

export async function lockCost(
  cwd: string,
  input: {
    projectId: string;
    reason: string;
    lockedBy?: string;
    now?: Date;
  },
): Promise<{ changed: boolean; lock: CostLockRecord; path: string }> {
  const projectId = normalizeProjectId(input.projectId);
  const reason = normalizeReason(input.reason);
  const state = await readCostLockFile(cwd);
  const existing = state.locks[projectId];
  const lock: CostLockRecord = {
    projectId,
    reason,
    lockedAt: existing?.lockedAt ?? (input.now ?? new Date()).toISOString(),
    ...(input.lockedBy?.trim() ? { lockedBy: input.lockedBy.trim() } : existing?.lockedBy ? { lockedBy: existing.lockedBy } : {}),
  };
  state.locks[projectId] = lock;
  await writeCostLockFile(cwd, state);
  return {
    changed: !sameLock(existing, lock),
    lock,
    path: COST_LOCK_PATH,
  };
}

export async function unlockCost(
  cwd: string,
  input: {
    projectId: string;
  },
): Promise<{ changed: boolean; previousLock?: CostLockRecord; path: string }> {
  const projectId = normalizeProjectId(input.projectId);
  const state = await readCostLockFile(cwd);
  const previousLock = state.locks[projectId];
  if (previousLock) {
    delete state.locks[projectId];
    await writeCostLockFile(cwd, state);
  }
  return {
    changed: !!previousLock,
    previousLock,
    path: COST_LOCK_PATH,
  };
}

export function resolveCostLockPath(cwd: string): string {
  return path.join(cwd, COST_LOCK_PATH);
}

function emptyCostLockFile(): CostLockFile {
  return {
    version: 1,
    locks: {},
  };
}

function normalizeCostLockFile(input: Partial<CostLockFile>): CostLockFile {
  const state = emptyCostLockFile();
  for (const [key, lock] of Object.entries(input.locks ?? {})) {
    if (!lock || typeof lock !== "object") {
      continue;
    }
    const projectId = normalizeProjectId(lock.projectId || key);
    state.locks[projectId] = {
      projectId,
      reason: normalizeReason(lock.reason),
      lockedAt: typeof lock.lockedAt === "string" && lock.lockedAt ? lock.lockedAt : new Date(0).toISOString(),
      ...(typeof lock.lockedBy === "string" && lock.lockedBy.trim() ? { lockedBy: lock.lockedBy.trim() } : {}),
    };
  }
  return state;
}

async function writeCostLockFile(cwd: string, state: CostLockFile): Promise<void> {
  const filePath = resolveCostLockPath(cwd);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function normalizeProjectId(value: string): string {
  const projectId = value.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new ValidationError("A valid project ID is required.");
  }
  return projectId;
}

function normalizeReason(value: string): string {
  const reason = value.trim();
  if (!reason) {
    throw new ValidationError("Cost lock reason is required.");
  }
  if (reason.length > 240) {
    throw new ValidationError("Cost lock reason must be 240 characters or less.");
  }
  return reason;
}

function sameLock(left: CostLockRecord | undefined, right: CostLockRecord): boolean {
  return !!left
    && left.projectId === right.projectId
    && left.reason === right.reason
    && left.lockedAt === right.lockedAt
    && left.lockedBy === right.lockedBy;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
