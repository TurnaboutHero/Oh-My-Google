import { describe, expect, it } from "vitest";
import {
  listSecrets,
  setSecret,
  type SecretManagerExecutor,
} from "../src/connectors/secret-manager.js";

describe("Secret Manager connector", () => {
  it("lists secret metadata without returning secret payloads", async () => {
    const calls: Array<{ args: string[] }> = [];
    const executor: SecretManagerExecutor = async (args) => {
      calls.push({ args });
      return {
        stdout: JSON.stringify([
          {
            name: "projects/demo-project/secrets/API_KEY",
            replication: { automatic: {} },
          },
        ]),
        stderr: "",
      };
    };

    const result = await listSecrets({ projectId: "demo-project", limit: 5 }, executor);

    expect(calls).toEqual([
      {
        args: [
          "secrets",
          "list",
          "--project=demo-project",
          "--format=json",
          "--limit=5",
        ],
      },
    ]);
    expect(result.secrets).toEqual([
      {
        name: "API_KEY",
        resourceName: "projects/demo-project/secrets/API_KEY",
        replication: "automatic",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
  });

  it("parses secret list output with leading non-json noise", async () => {
    const executor: SecretManagerExecutor = async () => ({
      stdout: `C:\\Temp\\omg\\tmpfile\r\n${JSON.stringify([
        {
          name: "projects/demo-project/secrets/API_KEY",
          replication: { automatic: {} },
        },
      ])}`,
      stderr: "",
    });

    const result = await listSecrets({ projectId: "demo-project", limit: 5 }, executor);

    expect(result.secrets).toEqual([
      {
        name: "API_KEY",
        resourceName: "projects/demo-project/secrets/API_KEY",
        replication: "automatic",
      },
    ]);
  });

  it("creates a missing secret without exposing the secret value in args or result", async () => {
    const calls: Array<{ args: string[] }> = [];
    const executor: SecretManagerExecutor = async (args) => {
      calls.push({ args });
      if (args.includes("describe")) {
        const error = new Error("not found") as Error & { exitCode: number; stderr: string };
        error.exitCode = 1;
        error.stderr = "NOT_FOUND";
        throw error;
      }
      return { stdout: "", stderr: "" };
    };

    const result = await setSecret(
      {
        projectId: "demo-project",
        name: "API_KEY",
        value: "super-secret-value",
      },
      executor,
    );

    expect(calls[0]?.args).toEqual([
      "secrets",
      "describe",
      "API_KEY",
      "--project=demo-project",
      "--format=json",
    ]);
    expect(calls[1]?.args.slice(0, 4)).toEqual([
      "secrets",
      "create",
      "API_KEY",
      "--project=demo-project",
    ]);
    expect(calls[1]?.args).toContain("--replication-policy=automatic");
    expect(calls[1]?.args.some((arg) => arg.startsWith("--data-file="))).toBe(true);
    expect(JSON.stringify(calls)).not.toContain("super-secret-value");
    expect(result).toEqual({
      projectId: "demo-project",
      name: "API_KEY",
      created: true,
      versionAdded: true,
    });
  });

  it("adds a new version when the secret already exists", async () => {
    const calls: Array<{ args: string[] }> = [];
    const executor: SecretManagerExecutor = async (args) => {
      calls.push({ args });
      if (args.includes("describe")) {
        return {
          stdout: JSON.stringify({ name: "projects/demo-project/secrets/API_KEY" }),
          stderr: "",
        };
      }
      return { stdout: "1", stderr: "" };
    };

    const result = await setSecret(
      {
        projectId: "demo-project",
        name: "API_KEY",
        value: "super-secret-value",
      },
      executor,
    );

    expect(calls[1]?.args.slice(0, 4)).toEqual([
      "secrets",
      "versions",
      "add",
      "API_KEY",
    ]);
    expect(calls[1]?.args).toContain("--project=demo-project");
    expect(calls[1]?.args.some((arg) => arg.startsWith("--data-file="))).toBe(true);
    expect(JSON.stringify(calls)).not.toContain("super-secret-value");
    expect(result).toEqual({
      projectId: "demo-project",
      name: "API_KEY",
      created: false,
      versionAdded: true,
    });
  });

  it("returns a redacted dry-run plan for secret writes", async () => {
    const result = await setSecret({
      projectId: "demo-project",
      name: "API_KEY",
      value: "super-secret-value",
      dryRun: true,
    });

    expect(result).toEqual({
      projectId: "demo-project",
      name: "API_KEY",
      dryRun: true,
      wouldCreateIfMissing: true,
      wouldAddVersion: true,
    });
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
  });
});
