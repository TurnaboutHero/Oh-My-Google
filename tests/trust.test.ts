import { describe, expect, it } from "vitest";
import { checkPermission } from "../src/trust/check.js";
import { generateDefaultProfile } from "../src/trust/profile.js";

describe("trust profile defaults", () => {
  it("allows low-risk deploys in dev by default", async () => {
    const profile = generateDefaultProfile("demo-project", "dev");
    const result = await checkPermission("deploy.cloud-run", profile, {
      jsonMode: true,
      yes: false,
    });

    expect(result.allowed).toBe(true);
    expect(result.action).toBe("auto");
  });

  it("requires manual approval for prod deploys", async () => {
    const profile = generateDefaultProfile("demo-project", "prod");
    const result = await checkPermission("deploy.cloud-run", profile, {
      jsonMode: true,
      yes: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.action).toBe("require_approval");
    expect(result.reasonCode).toBe("APPROVAL_REQUIRED");
  });
});
