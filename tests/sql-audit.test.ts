import { describe, expect, it } from "vitest";
import { auditSql, type SqlAuditExecutor } from "../src/connectors/sql-audit.js";

describe("Cloud SQL audit connector", () => {
  it("returns low risk when no instances are visible", async () => {
    const calls: string[][] = [];
    const audit = await auditSql("demo-project", async (args) => {
      calls.push(args);
      return { stdout: "[]", stderr: "" };
    });

    expect(calls).toEqual([
      [
        "sql",
        "instances",
        "list",
        "--project=demo-project",
        "--show-edition",
        "--show-sql-network-architecture",
        "--show-transactional-log-storage-state",
        "--format=json",
      ],
    ]);
    expect(audit).toEqual({
      projectId: "demo-project",
      instances: [],
      backups: [],
      findings: [],
      inaccessible: [],
      signals: [],
      risk: "low",
      recommendedAction: "No Cloud SQL instances were visible.",
    });
  });

  it("flags public authorized networks as high risk", async () => {
    const audit = await auditSql("demo-project", fixtures({
      instances: [
        {
          name: "orders-db",
          databaseVersion: "POSTGRES_15",
          region: "asia-northeast3",
          state: "RUNNABLE",
          settings: {
            availabilityType: "ZONAL",
            backupConfiguration: {
              enabled: true,
              pointInTimeRecoveryEnabled: false,
            },
            ipConfiguration: {
              ipv4Enabled: true,
              authorizedNetworks: [{ value: "0.0.0.0/0" }],
            },
            deletionProtectionEnabled: false,
          },
        },
      ],
      backups: {
        "orders-db": [
          {
            id: "backup-1",
            instance: "orders-db",
            status: "SUCCESSFUL",
            type: "AUTOMATED",
            windowStartTime: "2026-04-24T00:00:00Z",
          },
        ],
      },
    }));

    expect(audit.risk).toBe("high");
    expect(audit.instances).toEqual([
      {
        name: "orders-db",
        databaseVersion: "POSTGRES_15",
        region: "asia-northeast3",
        state: "RUNNABLE",
        availabilityType: "ZONAL",
        backupEnabled: true,
        pointInTimeRecoveryEnabled: false,
        ipv4Enabled: true,
        authorizedNetworks: ["0.0.0.0/0"],
        deletionProtectionEnabled: false,
      },
    ]);
    expect(audit.backups).toEqual([
      {
        instance: "orders-db",
        id: "backup-1",
        status: "SUCCESSFUL",
        type: "AUTOMATED",
        windowStartTime: "2026-04-24T00:00:00Z",
      },
    ]);
    expect(audit.findings).toEqual([
      {
        severity: "high",
        reason: "Cloud SQL authorized network is open to the public internet.",
        instance: "orders-db",
        network: "0.0.0.0/0",
      },
    ]);
    expect(audit.signals).toContain("1 Cloud SQL instance(s) visible.");
    expect(audit.signals).toContain("Point-in-time recovery is disabled for Cloud SQL instance orders-db.");
    expect(audit.signals).toContain("Deletion protection is disabled for Cloud SQL instance orders-db.");
    expect(audit.signals).toContain("Public IPv4 is enabled for Cloud SQL instance orders-db.");
  });

  it("keeps instance audit usable when backup listing is inaccessible", async () => {
    const audit = await auditSql("demo-project", fixtures({
      instances: [{ name: "orders-db" }],
      backupError: "permission denied",
    }));

    expect(audit.risk).toBe("review");
    expect(audit.inaccessible).toEqual(["backups:orders-db"]);
    expect(audit.signals).toContain("Cloud SQL audit could not inspect backups:orders-db.");
  });

  it("requires a valid project ID", async () => {
    await expect(auditSql("BAD_PROJECT", fixtures({ instances: [] })))
      .rejects
      .toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

function fixtures(input: {
  instances: Array<Record<string, unknown>>;
  backups?: Record<string, Array<Record<string, unknown>>>;
  backupError?: string;
}): SqlAuditExecutor {
  return async (args) => {
    if (args[0] === "sql" && args[1] === "instances" && args[2] === "list") {
      return { stdout: JSON.stringify(input.instances), stderr: "" };
    }
    if (args[0] === "sql" && args[1] === "backups" && args[2] === "list") {
      if (input.backupError) {
        throw Object.assign(new Error(input.backupError), {
          stderr: input.backupError,
          exitCode: 1,
        });
      }
      const instanceArg = args.find((arg) => arg.startsWith("--instance="));
      const instanceName = instanceArg?.replace("--instance=", "") ?? "";
      return { stdout: JSON.stringify(input.backups?.[instanceName] ?? []), stderr: "" };
    }
    return { stdout: "[]", stderr: "" };
  };
}
