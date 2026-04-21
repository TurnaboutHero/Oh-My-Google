import { describe, expect, it, vi } from "vitest";
import { handleAuthContext } from "../src/mcp/tools/auth.js";

vi.mock("../src/cli/auth.js", () => ({
  runAuthContext: vi.fn(async () => ({
    ok: true,
    command: "auth:context",
    data: {
      activeConfiguration: "default",
      gcloudAccount: "default@example.com",
      projectId: "default-project",
      adcAccount: null,
      configurations: [],
      accountContext: {
        ok: false,
        detail: "requires both gcloud and ADC accounts",
      },
    },
    next: ["gcloud auth application-default login"],
  })),
}));

describe("omg.auth MCP tools", () => {
  it("returns auth context in omg response shape", async () => {
    const result = await handleAuthContext({});

    expect(result.ok).toBe(true);
    expect(result.command).toBe("auth:context");
    expect(result.data?.gcloudAccount).toBe("default@example.com");
    expect(result.next).toContain("gcloud auth application-default login");
  });

  it("rejects unexpected auth context arguments", async () => {
    const result = await handleAuthContext({ extra: true });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});
