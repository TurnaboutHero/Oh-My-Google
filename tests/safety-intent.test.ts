import { describe, expect, it } from "vitest";
import {
  classifyOperation,
  getAdapterCapability,
  listAdapterCapabilities,
} from "../src/safety/intent.js";
import { ACTION_LEVELS } from "../src/trust/levels.js";

describe("operation intent classification", () => {
  it("classifies read-only audit operations as L0 without budget or approval requirements", () => {
    expect(classifyOperation("billing.audit", { projectId: "demo-project" })).toEqual({
      id: "billing.audit",
      service: "billing",
      action: "read",
      trustLevel: "L0",
      projectId: "demo-project",
      resource: "budget",
      adapter: "gcloud-cli",
      costBearing: false,
      destructive: false,
      secretTouching: false,
      requiresBudget: false,
      supportsDryRun: false,
      postVerify: false,
    });

    expect(classifyOperation("iam.audit", { projectId: "demo-project" })).toMatchObject({
      id: "iam.audit",
      service: "iam",
      action: "read",
      trustLevel: "L0",
      projectId: "demo-project",
      resource: "iam-policy",
      adapter: "gcloud-cli",
      requiresBudget: false,
    });
  });

  it("classifies deploy actions as cost-bearing writes that require budget guard", () => {
    expect(classifyOperation("deploy.cloud-run", {
      projectId: "demo-project",
      resource: "service/demo-api",
    })).toMatchObject({
      id: "deploy.cloud-run",
      service: "cloud-run",
      action: "deploy",
      trustLevel: "L1",
      projectId: "demo-project",
      resource: "service/demo-api",
      adapter: "gcloud-cli",
      costBearing: true,
      destructive: false,
      secretTouching: false,
      requiresBudget: true,
      supportsDryRun: true,
      postVerify: true,
    });

    expect(classifyOperation("deploy.firebase-hosting", { projectId: "demo-project" }))
      .toMatchObject({
        service: "firebase-hosting",
        action: "deploy",
        adapter: "firebase-cli",
        requiresBudget: true,
        supportsDryRun: true,
      });
  });

  it("classifies secret writes as secret-touching budget-gated L2 operations", () => {
    expect(classifyOperation("secret.set", {
      projectId: "demo-project",
      resource: "secret/API_KEY",
    })).toEqual({
      id: "secret.set",
      service: "secret-manager",
      action: "secret-write",
      trustLevel: "L2",
      projectId: "demo-project",
      resource: "secret/API_KEY",
      adapter: "gcloud-cli",
      costBearing: true,
      destructive: false,
      secretTouching: true,
      requiresBudget: true,
      supportsDryRun: true,
      postVerify: true,
    });
  });

  it("classifies project lifecycle actions as destructive L3 operations", () => {
    expect(classifyOperation("gcp.project.delete", { projectId: "demo-project" }))
      .toMatchObject({
        service: "project-lifecycle",
        action: "lifecycle",
        trustLevel: "L3",
        destructive: true,
        requiresBudget: false,
        supportsDryRun: false,
        postVerify: true,
      });

    expect(classifyOperation("gcp.project.undelete", { projectId: "demo-project" }))
      .toMatchObject({
        service: "project-lifecycle",
        action: "lifecycle",
        trustLevel: "L3",
        destructive: false,
        postVerify: true,
      });
  });

  it("returns a conservative default for unknown operations", () => {
    expect(classifyOperation("unknown.service.write", { projectId: "demo-project" }))
      .toMatchObject({
        id: "unknown.service.write",
        service: "unknown",
        action: "write",
        trustLevel: "L2",
        projectId: "demo-project",
        adapter: "unknown",
        costBearing: true,
        destructive: false,
        secretTouching: false,
        requiresBudget: true,
        supportsDryRun: false,
        postVerify: true,
      });
  });

  it("keeps every trust action ID classifiable with its configured trust level", () => {
    for (const [actionId, trustLevel] of Object.entries(ACTION_LEVELS)) {
      const intent = classifyOperation(actionId, { projectId: "demo-project" });

      expect(intent.id).toBe(actionId);
      expect(intent.trustLevel).toBe(trustLevel);
      expect(getAdapterCapability(intent.adapter)).toBeDefined();
    }
  });
});

describe("adapter capability manifest", () => {
  it("describes current execution backends without downstream MCP execution", () => {
    expect(getAdapterCapability("gcloud-cli")).toMatchObject({
      id: "gcloud-cli",
      kind: "cli",
      execution: "enabled",
      safetyBoundary: "operation-intent",
    });
    expect(getAdapterCapability("firebase-cli")).toMatchObject({
      id: "firebase-cli",
      kind: "cli",
      execution: "enabled",
      safetyBoundary: "operation-intent",
    });
    expect(getAdapterCapability("downstream-mcp")).toMatchObject({
      id: "downstream-mcp",
      kind: "mcp",
      execution: "discovery-only",
      safetyBoundary: "deny-by-default",
    });

    expect(listAdapterCapabilities().map((capability) => capability.id)).toEqual([
      "gcloud-cli",
      "firebase-cli",
      "google-client",
      "downstream-mcp",
      "unknown",
    ]);
  });
});
