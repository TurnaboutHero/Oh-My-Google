import { describe, expect, it, vi } from "vitest";
import { runFirestoreAudit } from "../src/cli/commands/firestore.js";

vi.mock("../src/connectors/firestore-audit.js", () => ({
  auditFirestore: vi.fn(async (projectId: string) => ({
    projectId,
    databases: [{ name: "projects/demo-project/databases/(default)", databaseId: "(default)" }],
    compositeIndexes: [],
    inaccessible: [],
    signals: ["1 Firestore database(s) visible."],
    risk: "review",
    recommendedAction: "Review Firestore databases before adding create, delete, export, import, or data mutation workflows.",
  })),
}));

describe("firestore command", () => {
  it("runs a read-only Firestore audit", async () => {
    const result = await runFirestoreAudit({ project: "demo-project" });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.risk : undefined).toBe("review");
    expect(result.ok ? result.next : undefined).toContain(
      "Review Firestore databases before adding create, delete, export, import, or data mutation workflows.",
    );
  });

  it("requires a project id", async () => {
    const result = await runFirestoreAudit({});

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("VALIDATION_ERROR");
  });
});
