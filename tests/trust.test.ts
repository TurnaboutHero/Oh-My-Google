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

  it("applies explicit deny policy before trust levels", async () => {
    const profile = generateDefaultProfile("demo-project", "dev");
    profile.deny = ["deploy.*"];

    const result = await checkPermission("deploy.cloud-run", profile, {
      jsonMode: true,
      yes: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.action).toBe("deny");
    expect(result.reasonCode).toBe("DENIED");
    expect(result.deniedBy).toBe("deploy.*");
  });

  it("matches wildcard deny patterns across action segments", async () => {
    const profile = generateDefaultProfile("demo-project", "dev");
    profile.deny = ["iam.role.*.owner"];

    const result = await checkPermission("iam.role.grant.owner", profile, {
      jsonMode: true,
      yes: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("DENIED");
    expect(result.deniedBy).toBe("iam.role.*.owner");
  });

  it("requires explicit confirmation for dev secret writes", async () => {
    const profile = generateDefaultProfile("demo-project", "dev");
    const result = await checkPermission("secret.set", profile, {
      jsonMode: true,
      yes: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.action).toBe("require_confirm");
    expect(result.reasonCode).toBe("REQUIRES_CONFIRM");
  });

  it("requires manual approval for prod secret writes", async () => {
    const profile = generateDefaultProfile("demo-project", "prod");
    const result = await checkPermission("secret.set", profile, {
      jsonMode: true,
      yes: true,
    });

    expect(result.allowed).toBe(false);
    expect(result.action).toBe("require_approval");
    expect(result.reasonCode).toBe("APPROVAL_REQUIRED");
  });
});
