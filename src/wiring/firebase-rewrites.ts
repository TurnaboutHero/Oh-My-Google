import fs from "node:fs/promises";
import path from "node:path";
import { OmgError } from "../types/errors.js";

export interface RewriteEdge {
  pattern: string;
  serviceName: string;
  region: string;
}

interface RewriteConfig {
  source?: string;
  run?: {
    serviceId: string;
    region: string;
  };
}

interface HostingConfig {
  rewrites?: RewriteConfig[];
  [key: string]: unknown;
}

interface FirebaseConfig {
  hosting?: HostingConfig | HostingConfig[];
  [key: string]: unknown;
}

export async function injectRewrite(cwd: string, edge: RewriteEdge): Promise<{ diff: string }> {
  const firebasePath = path.join(cwd, "firebase.json");
  let firebaseConfig: FirebaseConfig = {};
  let before = "{}";

  try {
    before = await fs.readFile(firebasePath, "utf-8");
    firebaseConfig = JSON.parse(before) as FirebaseConfig;
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }

  const nextConfig = updateFirebaseConfig(firebaseConfig, edge);
  const after = `${JSON.stringify(nextConfig, null, 2)}\n`;
  await fs.writeFile(firebasePath, after, "utf-8");

  return {
    diff: buildDiffSummary(before, after),
  };
}

function updateFirebaseConfig(firebaseConfig: FirebaseConfig, edge: RewriteEdge): FirebaseConfig {
  if (!firebaseConfig.hosting) {
    return {
      ...firebaseConfig,
      hosting: updateHosting({}, edge),
    };
  }

  if (Array.isArray(firebaseConfig.hosting)) {
    return {
      ...firebaseConfig,
      hosting: firebaseConfig.hosting.map((hosting) => updateHosting(hosting, edge)),
    };
  }

  return {
    ...firebaseConfig,
    hosting: updateHosting(firebaseConfig.hosting, edge),
  };
}

function updateHosting(hosting: HostingConfig, edge: RewriteEdge): HostingConfig {
  const rewrites = Array.isArray(hosting.rewrites) ? [...hosting.rewrites] : [];
  const filtered = rewrites.filter((rewrite) => rewrite.source !== edge.pattern);

  filtered.push({
    source: edge.pattern,
    run: {
      serviceId: edge.serviceName,
      region: edge.region,
    },
  });

  return {
    ...hosting,
    rewrites: filtered,
  };
}

function buildDiffSummary(before: string, after: string): string {
  const beforeLines = before.trim() ? before.trim().split(/\r?\n/) : ["(empty)"];
  const afterLines = after.trim().split(/\r?\n/);

  return [
    "--- before",
    ...beforeLines,
    "+++ after",
    ...afterLines,
  ].join("\n");
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
