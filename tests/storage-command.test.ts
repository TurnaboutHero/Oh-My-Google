import { describe, expect, it, vi } from "vitest";
import { runStorageAudit } from "../src/cli/commands/storage.js";

vi.mock("../src/connectors/storage-audit.js", () => ({
  auditStorage: vi.fn(async (projectId: string) => ({
    projectId,
    buckets: [{ name: "public-assets", url: "gs://public-assets", lifecycleRuleCount: 0 }],
    iamBindings: [],
    findings: [],
    inaccessible: [],
    signals: ["1 Cloud Storage bucket(s) visible."],
    risk: "review",
    recommendedAction: "Review Cloud Storage buckets before adding bucket, object, IAM, or lifecycle mutation workflows.",
  })),
}));

describe("storage command", () => {
  it("runs a read-only Cloud Storage audit", async () => {
    const result = await runStorageAudit({ project: "demo-project" });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.risk : undefined).toBe("review");
    expect(result.ok ? result.next : undefined).toContain(
      "Review Cloud Storage buckets before adding bucket, object, IAM, or lifecycle mutation workflows.",
    );
  });

  it("requires a project id", async () => {
    const result = await runStorageAudit({});

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("VALIDATION_ERROR");
  });
});
