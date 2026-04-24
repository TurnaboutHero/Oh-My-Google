import { describe, expect, it } from "vitest";
import { auditStorage, type StorageAuditExecutor } from "../src/connectors/storage-audit.js";

describe("Cloud Storage audit connector", () => {
  it("returns low risk when no buckets are visible", async () => {
    const calls: string[][] = [];
    const audit = await auditStorage("demo-project", async (args) => {
      calls.push(args);
      return { stdout: "[]", stderr: "" };
    });

    expect(calls).toEqual([
      ["storage", "buckets", "list", "--project=demo-project", "--raw", "--format=json"],
    ]);
    expect(audit).toEqual({
      projectId: "demo-project",
      buckets: [],
      iamBindings: [],
      findings: [],
      inaccessible: [],
      signals: [],
      risk: "low",
      recommendedAction: "No Cloud Storage buckets were visible.",
    });
  });

  it("flags public bucket IAM as high risk", async () => {
    const audit = await auditStorage("demo-project", fixtures({
      buckets: [
        {
          name: "public-assets",
          location: "US",
          storageClass: "STANDARD",
          iamConfiguration: {
            uniformBucketLevelAccess: { enabled: false },
            publicAccessPrevention: "inherited",
          },
          versioning: { enabled: true },
          lifecycle: { rule: [{ action: { type: "Delete" } }] },
        },
      ],
      iamPolicies: {
        "public-assets": {
          bindings: [
            { role: "roles/storage.objectViewer", members: ["allUsers"] },
          ],
        },
      },
    }));

    expect(audit.risk).toBe("high");
    expect(audit.buckets).toEqual([
      {
        name: "public-assets",
        url: "gs://public-assets",
        location: "US",
        storageClass: "STANDARD",
        uniformBucketLevelAccess: false,
        publicAccessPrevention: "inherited",
        versioningEnabled: true,
        lifecycleRuleCount: 1,
      },
    ]);
    expect(audit.iamBindings).toEqual([
      {
        bucket: "public-assets",
        role: "roles/storage.objectViewer",
        members: ["allUsers"],
        memberCount: 1,
        public: true,
      },
    ]);
    expect(audit.findings).toEqual([
      {
        severity: "high",
        reason: "Public principal has a Cloud Storage bucket IAM binding.",
        bucket: "public-assets",
        role: "roles/storage.objectViewer",
        member: "allUsers",
      },
    ]);
    expect(audit.signals).toContain("1 Cloud Storage bucket(s) visible.");
    expect(audit.signals).toContain("Public access prevention is not enforced for Cloud Storage bucket public-assets.");
    expect(audit.signals).toContain("Uniform bucket-level access is disabled for Cloud Storage bucket public-assets.");
  });

  it("keeps bucket audit usable when bucket IAM is inaccessible", async () => {
    const audit = await auditStorage("demo-project", fixtures({
      buckets: [{ name: "private-assets" }],
      iamError: "permission denied",
    }));

    expect(audit.risk).toBe("review");
    expect(audit.inaccessible).toEqual(["bucket iam:private-assets"]);
    expect(audit.signals).toContain("Cloud Storage audit could not inspect bucket iam:private-assets.");
  });

  it("requires a valid project ID", async () => {
    await expect(auditStorage("BAD_PROJECT", fixtures({ buckets: [] })))
      .rejects
      .toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

function fixtures(input: {
  buckets: Array<Record<string, unknown>>;
  iamPolicies?: Record<string, Record<string, unknown>>;
  iamError?: string;
}): StorageAuditExecutor {
  return async (args) => {
    if (args[0] === "storage" && args[1] === "buckets" && args[2] === "list") {
      return { stdout: JSON.stringify(input.buckets), stderr: "" };
    }
    if (args[0] === "storage" && args[1] === "buckets" && args[2] === "get-iam-policy") {
      if (input.iamError) {
        throw Object.assign(new Error(input.iamError), {
          stderr: input.iamError,
          exitCode: 1,
        });
      }
      const bucketName = String(args[3] ?? "").replace("gs://", "");
      return { stdout: JSON.stringify(input.iamPolicies?.[bucketName] ?? { bindings: [] }), stderr: "" };
    }
    return { stdout: "[]", stderr: "" };
  };
}
