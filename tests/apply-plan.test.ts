import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "../src/types/plan.js";
import { generateDefaultProfile } from "../src/trust/profile.js";

const cloudRunExecute = vi.fn();
const cloudRunRollback = vi.fn();
const firebaseExecute = vi.fn();
const resolveEnv = vi.fn();
const injectRewrite = vi.fn();

vi.mock("../src/connectors/cloud-run.js", () => ({
  cloudRunConnector: {
    execute: cloudRunExecute,
    rollback: cloudRunRollback,
  },
}));

vi.mock("../src/connectors/firebase.js", () => ({
  firebaseConnector: {
    execute: firebaseExecute,
  },
}));

vi.mock("../src/wiring/env-inject.js", () => ({
  resolveEnv,
}));

vi.mock("../src/wiring/firebase-rewrites.js", () => ({
  injectRewrite,
}));

beforeEach(() => {
  cloudRunExecute.mockReset();
  cloudRunRollback.mockReset();
  firebaseExecute.mockReset();
  resolveEnv.mockReset();
  injectRewrite.mockReset();
  resolveEnv.mockResolvedValue({});
  injectRewrite.mockResolvedValue({ diff: "updated" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("applyPlan", () => {
  it("fails when Cloud Run does not report a ready revision", async () => {
    const { applyPlan } = await import("../src/executor/apply.js");

    cloudRunExecute
      .mockResolvedValueOnce(successResult("cloud-run", "deploy", { url: "https://backend.example" }))
      .mockResolvedValueOnce(successResult("cloud-run", "describe", {
        url: "https://backend.example",
        ready: false,
      }));

    await expect(
      applyPlan(apiOnlyPlan(), {
        cwd: process.cwd(),
        profile: generateDefaultProfile("demo-project", "staging"),
        dryRun: false,
        yes: true,
      }),
    ).rejects.toMatchObject({ code: "DEPLOY_FAILED" });

    expect(cloudRunRollback).toHaveBeenCalledTimes(1);
  });

  it("rolls back backend deployment when frontend verification fails", async () => {
    const { applyPlan } = await import("../src/executor/apply.js");

    cloudRunExecute
      .mockResolvedValueOnce(successResult("cloud-run", "deploy", { url: "https://backend.example" }))
      .mockResolvedValueOnce(successResult("cloud-run", "describe", {
        url: "https://backend.example",
        ready: true,
      }));
    firebaseExecute.mockResolvedValueOnce(successResult("firebase", "hosting.deploy", {}));
    cloudRunRollback.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }));

    await expect(
      applyPlan(spaPlan(), {
        cwd: process.cwd(),
        profile: generateDefaultProfile("demo-project", "staging"),
        dryRun: false,
        yes: true,
      }),
    ).rejects.toMatchObject({ code: "DEPLOY_FAILED" });

    expect(injectRewrite).toHaveBeenCalled();
    expect(cloudRunRollback).toHaveBeenCalledTimes(1);
  });
});

function apiOnlyPlan(): Plan {
  return {
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
        serviceName: "demo-api",
        region: "asia-northeast3",
      },
    },
    wiring: [],
    environment: {
      backend: {},
      frontend: {},
    },
    deploymentOrder: ["backend"],
    checks: [],
    warnings: [],
  };
}

function spaPlan(): Plan {
  return {
    version: 1,
    detected: {
      stack: "spa-plus-api",
      frontend: {
        type: "vite-react",
        buildCommand: "vite build",
        outputDir: "dist",
      },
      backend: {
        type: "generic-docker",
        dockerfile: "Dockerfile",
        port: 8080,
      },
    },
    targets: {
      frontend: {
        service: "firebase-hosting",
        siteName: "demo-project",
      },
      backend: {
        service: "cloud-run",
        serviceName: "demo-api",
        region: "asia-northeast3",
      },
    },
    wiring: [
      {
        from: "frontend.rewrites[/api/**]",
        to: "backend.cloudRun.url",
      },
    ],
    environment: {
      backend: {},
      frontend: {},
    },
    deploymentOrder: ["backend", "frontend"],
    checks: [],
    warnings: [],
  };
}

function successResult(
  connector: "cloud-run" | "firebase",
  action: string,
  data: Record<string, unknown>,
) {
  return {
    success: true,
    data,
    metadata: {
      connector,
      action,
      durationMs: 1,
      timestamp: new Date().toISOString(),
    },
  };
}
