import { describe, expect, it, vi } from "vitest";
import { handleStorageAudit } from "../src/mcp/tools/storage.js";

vi.mock("../src/cli/commands/storage.js", () => ({
  runStorageAudit: vi.fn(async () => ({
    ok: true,
    data: {
      projectId: "demo-project",
      buckets: [],
      iamBindings: [],
      findings: [],
      inaccessible: [],
      signals: [],
      risk: "low",
      recommendedAction: "No Cloud Storage buckets were visible.",
    },
    next: [],
  })),
}));

describe("omg.storage MCP tools", () => {
  it("returns Cloud Storage audit output", async () => {
    const result = await handleStorageAudit({ project: "demo-project" });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("storage:audit");
    expect(result.data?.risk).toBe("low");
  });

  it("rejects unknown arguments", async () => {
    const result = await handleStorageAudit({ project: "demo-project", nope: true });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});
