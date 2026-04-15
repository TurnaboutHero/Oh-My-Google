import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detect } from "../src/planner/detect.js";
import { buildPlan } from "../src/planner/plan-builder.js";
import { injectRewrite } from "../src/wiring/firebase-rewrites.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("planner", () => {
  it("detects a spa-plus-api repo and builds a backend-first plan", async () => {
    const cwd = await makeTempDir();
    await fs.writeFile(path.join(cwd, "Dockerfile"), "FROM node:20\n", "utf-8");
    await fs.writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({
        scripts: { build: "vite build" },
        devDependencies: { vite: "^5.0.0" },
      }, null, 2),
      "utf-8",
    );
    await fs.writeFile(
      path.join(cwd, "firebase.json"),
      JSON.stringify({ hosting: { public: "dist" } }, null, 2),
      "utf-8",
    );

    const detected = await detect(cwd);
    const plan = buildPlan(detected, {
      projectId: "demo-project",
      enabledApis: [],
      cloudRunServices: [],
      firebaseLinked: true,
      region: "asia-northeast3",
    });

    expect(detected.stack).toBe("spa-plus-api");
    expect(plan.deploymentOrder).toEqual(["backend", "frontend"]);
    expect(plan.wiring).toEqual([
      {
        from: "frontend.rewrites[/api/**]",
        to: "backend.cloudRun.url",
      },
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it("adds a warning when the repo looks like Next.js", async () => {
    const cwd = await makeTempDir();
    await fs.writeFile(path.join(cwd, "next.config.js"), "module.exports = {};\n", "utf-8");
    await fs.writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({
        scripts: { build: "next build" },
      }, null, 2),
      "utf-8",
    );
    await fs.writeFile(
      path.join(cwd, "firebase.json"),
      JSON.stringify({ hosting: { public: "out" } }, null, 2),
      "utf-8",
    );

    const detected = await detect(cwd);
    const plan = buildPlan(detected, {
      projectId: "demo-project",
      enabledApis: [],
      cloudRunServices: [],
      firebaseLinked: true,
      region: "asia-northeast3",
    });

    expect(detected.frontend?.type).toBe("next-static");
    expect(plan.warnings).toContain(
      "Next.js repositories are only partially supported in Phase 1. Prefer static export output or use Vercel for SSR.",
    );
  });

  it("detects Vue and keeps the configured Vite output directory", async () => {
    const cwd = await makeTempDir();
    await fs.writeFile(
      path.join(cwd, "package.json"),
      JSON.stringify({
        scripts: { build: "vite build" },
        dependencies: { vue: "^3.0.0" },
        devDependencies: { vite: "^5.0.0" },
      }, null, 2),
      "utf-8",
    );
    await fs.writeFile(
      path.join(cwd, "vite.config.ts"),
      "export default { build: { outDir: 'web-dist' } };\n",
      "utf-8",
    );

    const detected = await detect(cwd);

    expect(detected.frontend?.type).toBe("vite-vue");
    expect(detected.frontend?.outputDir).toBe("web-dist");
  });

  it("detects Flask and Docker EXPOSE ports for api-only repos", async () => {
    const cwd = await makeTempDir();
    await fs.writeFile(
      path.join(cwd, "Dockerfile"),
      "FROM python:3.12\nEXPOSE 9090\n",
      "utf-8",
    );
    await fs.writeFile(
      path.join(cwd, "requirements.txt"),
      "flask==3.0.0\n",
      "utf-8",
    );

    const detected = await detect(cwd);

    expect(detected.stack).toBe("api-only");
    expect(detected.backend?.type).toBe("python-flask");
    expect(detected.backend?.port).toBe(9090);
  });
});

describe("firebase rewrites", () => {
  it("replaces an existing rewrite for the same pattern", async () => {
    const cwd = await makeTempDir();
    await fs.writeFile(
      path.join(cwd, "firebase.json"),
      JSON.stringify({
        hosting: {
          public: "dist",
          rewrites: [
            { source: "/api/**", run: { serviceId: "old-service", region: "us-central1" } },
            { source: "**", destination: "/index.html" },
          ],
        },
      }, null, 2),
      "utf-8",
    );

    await injectRewrite(cwd, {
      pattern: "/api/**",
      serviceName: "new-service",
      region: "asia-northeast3",
    });

    const updated = JSON.parse(await fs.readFile(path.join(cwd, "firebase.json"), "utf-8")) as {
      hosting: { rewrites: Array<Record<string, unknown>> };
    };

    expect(updated.hosting.rewrites).toContainEqual({
      source: "/api/**",
      run: {
        serviceId: "new-service",
        region: "asia-northeast3",
      },
    });
    expect(updated.hosting.rewrites).not.toContainEqual({
      source: "/api/**",
      run: {
        serviceId: "old-service",
        region: "us-central1",
      },
    });
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-test-"));
  tempDirs.push(dir);
  return dir;
}
