import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApproval, loadApproval, saveApproval } from "../src/approval/queue.js";
import { handleDeploy } from "../src/mcp/tools/deploy.js";
import { savePlan } from "../src/planner/schema.js";
import { generateDefaultProfile, saveProfile } from "../src/trust/profile.js";
import type { Plan } from "../src/types/plan.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("omg.deploy MCP tool", () => {
  it("returns no plan for an empty cwd", async () => {
    const cwd = await createTempWorkspace();

    const result = await withCwd(cwd, () => handleDeploy({}));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NO_PLAN");
  });

  it("returns the deployment plan for a dev dry-run", async () => {
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "dev");

    const result = await withCwd(cwd, () => handleDeploy({ dryRun: true }));

    expect(result.ok).toBe(true);
    expect(result.data?.plan).toBeDefined();
    expect(result.next).toContain("omg deploy --yes");
  });

  it("creates an approval when prod deploy requires manual approval", async () => {
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "prod");

    const result = await withCwd(cwd, () => handleDeploy({}));
    const approvalId = String(result.data?.approvalId ?? "");
    const approvals = await fs.readdir(path.join(cwd, ".omg", "approvals"));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("APPROVAL_REQUIRED");
    expect(approvalId).toMatch(/^apr_/);
    expect(result.next).toContain(`omg approve ${approvalId}`);
    expect(result.next).toContain(`omg deploy --approval ${approvalId}`);
    expect(approvals).toHaveLength(1);
  });

  it("expires an approved approval that is past its expiration", async () => {
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "prod");
    const approval = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args: deployArgs("demo-api"),
      projectId: "demo-project",
      environment: "prod",
      requestedBy: "agent",
      ttlMinutes: -1,
    });
    await saveApproval(cwd, {
      ...approval,
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await withCwd(cwd, () => handleDeploy({ approval: approval.id }));
    const stored = await loadApproval(cwd, approval.id);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("APPROVAL_EXPIRED");
    expect(stored?.status).toBe("expired");
  });

  it("rejects an approval when deploy args changed after approval", async () => {
    const cwd = await createTempWorkspace();
    await writeDeployFixtures(cwd, "prod", "other");
    const approval = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args: deployArgs("demo-api"),
      projectId: "demo-project",
      environment: "prod",
      requestedBy: "agent",
    });
    await saveApproval(cwd, {
      ...approval,
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await withCwd(cwd, () => handleDeploy({ approval: approval.id }));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("APPROVAL_MISMATCH");
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-mcp-deploy-"));
  tempDirs.push(dir);
  return dir;
}

async function writeDeployFixtures(
  cwd: string,
  environment: "dev" | "prod",
  serviceName = "demo-api",
): Promise<void> {
  const plan: Plan = {
    version: 1,
    detected: {
      stack: "api-only",
      backend: {
        type: "generic-docker",
        dockerfile: "Dockerfile",
        port: 8080,
      },
    },
    targets: {
      backend: {
        service: "cloud-run",
        serviceName,
        region: "asia-northeast3",
      },
    },
    wiring: [],
    environment: {
      backend: {},
      frontend: {},
    },
    deploymentOrder: ["backend"],
    checks: ["Cloud Run target resolved"],
    warnings: [],
  };

  const profile = generateDefaultProfile("demo-project", environment);

  await savePlan(cwd, plan);
  await saveProfile(cwd, profile);
}

function deployArgs(service: string): Record<string, unknown> {
  return {
    service,
    region: "asia-northeast3",
    image: "Dockerfile",
    port: 8080,
    runtime: "generic-docker",
    envKeys: [],
  };
}

async function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const originalCwd = process.cwd;
  process.cwd = (() => cwd) as typeof process.cwd;

  try {
    return await fn();
  } finally {
    process.cwd = originalCwd;
  }
}
