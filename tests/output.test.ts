import { afterEach, describe, expect, it, vi } from "vitest";
import { fail, setOutputFormat, success } from "../src/cli/output.js";

afterEach(() => {
  setOutputFormat("human");
  vi.restoreAllMocks();
});

describe("human output formatting", () => {
  it("prints success markers and next steps in human mode", () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    setOutputFormat("human");
    success("deploy", "Deployment completed.", { region: "asia-northeast3" }, ["omg doctor"]);

    expect(logs[0]).toBe("✓ Deployment completed.");
    expect(logs).toContain("region: asia-northeast3");
    expect(logs).toContain("Next:");
    expect(logs).toContain("- omg doctor");
  });

  it("prints error markers and hints in human mode", () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.join(" "));
    });

    setOutputFormat("human");
    fail("deploy", "DEPLOY_FAILED", "Deployment failed.", false, "--yes");

    expect(errors[0]).toBe("✗ Deployment failed.");
    expect(errors[1]).toBe("Hint: --yes");
  });
});
