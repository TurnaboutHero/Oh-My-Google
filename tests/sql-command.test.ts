import { describe, expect, it, vi } from "vitest";
import { runSqlAudit } from "../src/cli/commands/sql.js";

vi.mock("../src/connectors/sql-audit.js", () => ({
  auditSql: vi.fn(async (projectId: string) => ({
    projectId,
    instances: [{ name: "orders-db", authorizedNetworks: [] }],
    backups: [],
    findings: [],
    inaccessible: [],
    signals: ["1 Cloud SQL instance(s) visible."],
    risk: "review",
    recommendedAction: "Review Cloud SQL instances before adding instance, backup, export, import, or lifecycle mutation workflows.",
  })),
}));

describe("sql command", () => {
  it("runs a read-only Cloud SQL audit", async () => {
    const result = await runSqlAudit({ project: "demo-project" });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.risk : undefined).toBe("review");
    expect(result.ok ? result.next : undefined).toContain(
      "Review Cloud SQL instances before adding instance, backup, export, import, or lifecycle mutation workflows.",
    );
  });

  it("requires a project id", async () => {
    const result = await runSqlAudit({});

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("VALIDATION_ERROR");
  });
});
