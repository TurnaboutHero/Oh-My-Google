import { describe, expect, it, vi } from "vitest";
import { handleFirestoreAudit } from "../src/mcp/tools/firestore.js";

vi.mock("../src/cli/commands/firestore.js", () => ({
  runFirestoreAudit: vi.fn(async () => ({
    ok: true,
    data: {
      projectId: "demo-project",
      databases: [],
      compositeIndexes: [],
      inaccessible: [],
      signals: [],
      risk: "low",
      recommendedAction: "No Firestore databases were visible.",
    },
    next: [],
  })),
}));

describe("omg.firestore MCP tools", () => {
  it("returns Firestore audit output", async () => {
    const result = await handleFirestoreAudit({ project: "demo-project" });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("firestore:audit");
    expect(result.data?.risk).toBe("low");
  });

  it("rejects unknown arguments", async () => {
    const result = await handleFirestoreAudit({ project: "demo-project", nope: true });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});
