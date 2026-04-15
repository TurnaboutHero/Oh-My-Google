import { describe, expect, it } from "vitest";
import { CloudRunConnector } from "../src/connectors/cloud-run.js";
import { FirebaseConnector } from "../src/connectors/firebase.js";

describe("CloudRunConnector", () => {
  it("returns a dry-run deployment result without calling gcloud", async () => {
    const connector = new CloudRunConnector();
    const result = await connector.execute(
      "deploy",
      {
        service: "demo-service",
        region: "asia-northeast3",
        source: ".",
        dryRun: true,
      },
      {
        project: {
          projectId: "demo-project",
          region: "asia-northeast3",
        },
      },
    );

    expect(result.success).toBe(true);
    expect(result.data?.dryRun).toBe(true);
    expect(result.metadata.connector).toBe("cloud-run");
  });

  it("rejects unsupported actions", async () => {
    const connector = new CloudRunConnector();
    const result = await connector.execute(
      "nope",
      {},
      {
        project: {
          projectId: "demo-project",
        },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});

describe("FirebaseConnector", () => {
  it("returns a dry-run hosting deployment result without calling firebase", async () => {
    const connector = new FirebaseConnector();
    const result = await connector.execute(
      "hosting.deploy",
      {
        cwd: process.cwd(),
        dryRun: true,
      },
      {
        project: {
          projectId: "demo-project",
        },
      },
    );

    expect(result.success).toBe(true);
    expect(result.data?.dryRun).toBe(true);
    expect(result.data?.args).toContain("deploy");
    expect(result.metadata.connector).toBe("firebase");
  });

  it("rejects unsupported actions", async () => {
    const connector = new FirebaseConnector();
    const result = await connector.execute(
      "invalid",
      {},
      {
        project: {
          projectId: "demo-project",
        },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});
