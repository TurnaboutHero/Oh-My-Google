import { describe, expect, it } from "vitest";
import { auditFirestore, type FirestoreAuditExecutor } from "../src/connectors/firestore-audit.js";

describe("Firestore audit connector", () => {
  it("returns low risk when no Firestore databases are visible", async () => {
    const calls: string[][] = [];
    const audit = await auditFirestore("demo-project", async (args) => {
      calls.push(args);
      return { stdout: "[]", stderr: "" };
    });

    expect(calls).toEqual([
      ["firestore", "databases", "list", "--project=demo-project", "--format=json"],
    ]);
    expect(audit).toEqual({
      projectId: "demo-project",
      databases: [],
      compositeIndexes: [],
      inaccessible: [],
      signals: [],
      risk: "low",
      recommendedAction: "No Firestore databases were visible.",
    });
  });

  it("summarizes databases and composite indexes as review posture", async () => {
    const audit = await auditFirestore("demo-project", fixtures({
      databases: [
        {
          name: "projects/demo-project/databases/(default)",
          locationId: "nam5",
          type: "FIRESTORE_NATIVE",
          pointInTimeRecoveryEnablement: "POINT_IN_TIME_RECOVERY_DISABLED",
          deleteProtectionState: "DELETE_PROTECTION_DISABLED",
        },
      ],
      indexes: {
        "(default)": [
          {
            name: "projects/demo-project/databases/(default)/collectionGroups/events/indexes/index-1",
            collectionGroup: "events",
            queryScope: "COLLECTION",
            state: "READY",
            fields: [{ fieldPath: "createdAt" }, { fieldPath: "__name__" }],
          },
        ],
      },
    }));

    expect(audit.risk).toBe("review");
    expect(audit.databases).toEqual([
      {
        name: "projects/demo-project/databases/(default)",
        databaseId: "(default)",
        locationId: "nam5",
        type: "FIRESTORE_NATIVE",
        pointInTimeRecoveryEnablement: "POINT_IN_TIME_RECOVERY_DISABLED",
        deleteProtectionState: "DELETE_PROTECTION_DISABLED",
      },
    ]);
    expect(audit.compositeIndexes).toEqual([
      {
        name: "projects/demo-project/databases/(default)/collectionGroups/events/indexes/index-1",
        databaseId: "(default)",
        collectionGroup: "events",
        queryScope: "COLLECTION",
        state: "READY",
        fieldCount: 2,
      },
    ]);
    expect(audit.signals).toContain("1 Firestore database(s) visible.");
    expect(audit.signals).toContain("Delete protection is disabled for Firestore database (default).");
    expect(audit.signals).toContain("Point-in-time recovery is disabled for Firestore database (default).");
    expect(audit.signals).toContain("1 Firestore composite index(es) visible.");
  });

  it("keeps database audit usable when index listing is inaccessible", async () => {
    const audit = await auditFirestore("demo-project", fixtures({
      databases: [
        {
          name: "projects/demo-project/databases/(default)",
        },
      ],
      indexError: "permission denied",
    }));

    expect(audit.risk).toBe("review");
    expect(audit.inaccessible).toEqual(["composite indexes:(default)"]);
    expect(audit.signals).toContain("Firestore audit could not inspect composite indexes:(default).");
  });

  it("requires a valid project ID", async () => {
    await expect(auditFirestore("BAD_PROJECT", fixtures({ databases: [] })))
      .rejects
      .toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

function fixtures(input: {
  databases: Array<Record<string, unknown>>;
  indexes?: Record<string, Array<Record<string, unknown>>>;
  indexError?: string;
}): FirestoreAuditExecutor {
  return async (args) => {
    if (args[0] === "firestore" && args[1] === "databases" && args[2] === "list") {
      return { stdout: JSON.stringify(input.databases), stderr: "" };
    }
    if (args[0] === "firestore" && args[1] === "indexes" && args[2] === "composite") {
      if (input.indexError) {
        throw Object.assign(new Error(input.indexError), {
          stderr: input.indexError,
          exitCode: 1,
        });
      }
      const databaseArg = args.find((arg) => arg.startsWith("--database="));
      const databaseId = databaseArg?.replace("--database=", "") ?? "(default)";
      return { stdout: JSON.stringify(input.indexes?.[databaseId] ?? []), stderr: "" };
    }
    return { stdout: "[]", stderr: "" };
  };
}
