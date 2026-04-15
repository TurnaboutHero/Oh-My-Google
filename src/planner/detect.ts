import fs from "node:fs/promises";
import path from "node:path";
import type { DetectedBackend, DetectedFrontend, DetectedState } from "../types/plan.js";

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface FirebaseJson {
  hosting?: {
    public?: string;
  } | Array<{
    public?: string;
  }>;
}

export async function detect(cwd: string): Promise<DetectedState> {
  const packageJson = await readJson<PackageJson>(path.join(cwd, "package.json"));
  const firebaseJson = await readJson<FirebaseJson>(path.join(cwd, "firebase.json"));
  const requirementsTxt = await readText(path.join(cwd, "requirements.txt"));
  const pyprojectToml = await readText(path.join(cwd, "pyproject.toml"));
  const dockerfile = await readText(path.join(cwd, "Dockerfile"));
  const hasDockerfile = await exists(path.join(cwd, "Dockerfile"));
  const hasFunctionsDir = await exists(path.join(cwd, "functions"));
  const hasPublicDir = await exists(path.join(cwd, "public"));
  const hasIndexHtml = await exists(path.join(cwd, "index.html"));
  const hasNextConfig = await hasAny(cwd, ["next.config.js", "next.config.ts"]);
  const hasRequirements = await exists(path.join(cwd, "requirements.txt"));
  const hasPyproject = await exists(path.join(cwd, "pyproject.toml"));

  const frontend = await detectFrontend(cwd, packageJson, firebaseJson, {
    hasPublicDir,
    hasIndexHtml,
    hasNextConfig,
  });
  const backend = detectBackend(packageJson, {
    hasDockerfile,
    requirementsTxt,
    pyprojectToml,
    dockerfile,
  });

  if (frontend && backend) {
    return {
      stack: "spa-plus-api",
      frontend,
      backend,
    };
  }

  if (backend) {
    return {
      stack: "api-only",
      backend,
    };
  }

  if (hasFunctionsDir) {
    return {
      stack: "functions",
    };
  }

  if (frontend) {
    return {
      stack: "static",
      frontend,
    };
  }

  return {
    stack: "unknown",
  };
}

async function detectFrontend(
  cwd: string,
  packageJson: PackageJson | null,
  firebaseJson: FirebaseJson | null,
  options: {
    hasPublicDir: boolean;
    hasIndexHtml: boolean;
    hasNextConfig: boolean;
  },
): Promise<DetectedFrontend | undefined> {
  const buildCommand = packageJson?.scripts?.build;
  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
  };
  const firebasePublic = getFirebasePublicDir(firebaseJson);

  if (
    !buildCommand &&
    !options.hasPublicDir &&
    !options.hasIndexHtml &&
    !firebasePublic &&
    !options.hasNextConfig
  ) {
    return undefined;
  }

  if (options.hasNextConfig || buildCommand?.includes("next")) {
    return {
      type: "next-static",
      buildCommand: buildCommand ?? "npm run build",
      outputDir: (await readConfiguredOutputDir(cwd, "next")) ?? firebasePublic ?? "out",
    };
  }

  if ((dependencies.vite || buildCommand?.includes("vite")) && (dependencies.vue || dependencies["vue-router"])) {
    return {
      type: "vite-vue",
      buildCommand: buildCommand ?? "npm run build",
      outputDir: (await readConfiguredOutputDir(cwd, "vite")) ?? firebasePublic ?? "dist",
    };
  }

  if (
    (dependencies.vite || buildCommand?.includes("vite"))
    && (dependencies.svelte || dependencies["@sveltejs/kit"])
  ) {
    return {
      type: "vite-svelte",
      buildCommand: buildCommand ?? "npm run build",
      outputDir: (await readConfiguredOutputDir(cwd, "vite")) ?? firebasePublic ?? "dist",
    };
  }

  if (dependencies.vite || buildCommand?.includes("vite")) {
    return {
      type: "vite-react",
      buildCommand: buildCommand ?? "npm run build",
      outputDir: (await readConfiguredOutputDir(cwd, "vite")) ?? firebasePublic ?? "dist",
    };
  }

  if (dependencies["react-scripts"]) {
    return {
      type: "cra",
      buildCommand: buildCommand ?? "npm run build",
      outputDir: firebasePublic ?? "build",
    };
  }

  return {
    type: "plain-html",
    buildCommand,
    outputDir: firebasePublic ?? (options.hasPublicDir ? "public" : "."),
  };
}

function detectBackend(
  packageJson: PackageJson | null,
  options: {
    hasDockerfile: boolean;
    requirementsTxt: string | null;
    pyprojectToml: string | null;
    dockerfile: string | null;
  },
): DetectedBackend | undefined {
  if (!options.hasDockerfile) {
    return undefined;
  }

  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
  };

  let type = "generic-docker";
  const pythonConfig = `${options.requirementsTxt ?? ""}\n${options.pyprojectToml ?? ""}`.toLowerCase();
  if (pythonConfig.includes("flask")) {
    type = "python-flask";
  } else if (
    pythonConfig.includes("fastapi")
    || options.requirementsTxt !== null
    || options.pyprojectToml !== null
  ) {
    type = "python-fastapi";
  } else if (dependencies.fastify) {
    type = "node-fastify";
  } else if (dependencies.express) {
    type = "node-express";
  }

  return {
    type,
    dockerfile: "Dockerfile",
    port: readDockerfilePort(options.dockerfile) ?? 8080,
  };
}

async function readConfiguredOutputDir(
  cwd: string,
  framework: "vite" | "next",
): Promise<string | undefined> {
  const configFiles =
    framework === "vite"
      ? ["vite.config.ts", "vite.config.js", "vite.config.mjs"]
      : ["next.config.ts", "next.config.js", "next.config.mjs"];

  for (const fileName of configFiles) {
    const filePath = path.join(cwd, fileName);
    if (!(await exists(filePath))) {
      continue;
    }

    const raw = await fs.readFile(filePath, "utf-8");
    const pattern =
      framework === "vite"
        ? /outDir\s*:\s*["'`]([^"'`]+)["'`]/
        : /distDir\s*:\s*["'`]([^"'`]+)["'`]/;
    const match = raw.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

async function hasAny(cwd: string, fileNames: string[]): Promise<boolean> {
  for (const fileName of fileNames) {
    if (await exists(path.join(cwd, fileName))) {
      return true;
    }
  }
  return false;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getFirebasePublicDir(firebaseJson: FirebaseJson | null): string | undefined {
  if (!firebaseJson?.hosting) {
    return undefined;
  }

  if (Array.isArray(firebaseJson.hosting)) {
    return firebaseJson.hosting[0]?.public;
  }

  return firebaseJson.hosting.public;
}

function readDockerfilePort(dockerfile: string | null): number | undefined {
  if (!dockerfile) {
    return undefined;
  }

  const match = dockerfile.match(/^\s*EXPOSE\s+(\d+)/im);
  if (!match) {
    return undefined;
  }

  const port = Number(match[1]);
  return Number.isFinite(port) ? port : undefined;
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
