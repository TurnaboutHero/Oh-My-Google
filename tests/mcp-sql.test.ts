import { describe, expect, it, vi } from "vitest";
import { handleSqlAudit } from "../src/mcp/tools/sql.js";

vi.mock("../src/cli/commands/sql.js", () => ({
  runSqlAudit: vi.fn(async () => ({
    ok: true,
    data: {
      projectId: "demo-project",
      instances: [],
      backups: [],
      findings: [],
      inaccessible: [],
      signals: [],
      risk: "low",
      recommendedAction: "No Cloud SQL instances were visible.",
    },
    next: [],
  })),
}));

describe("omg.sql MCP tools", () => {
  it("returns Cloud SQL audit output", async () => {
    const result = await handleSqlAudit({ project: "demo-project" });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("sql:audit");
    expect(result.data?.risk).toBe("low");
  });

  it("rejects unknown arguments", async () => {
    const result = await handleSqlAudit({ project: "demo-project", nope: true });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});
