/**
 * Plan — `omg link` 산출물. `.omg/project.yaml`로 저장.
 * `omg deploy`가 이 plan대로 실행.
 */

export type StackType =
  | "static"
  | "spa-plus-api"
  | "api-only"
  | "functions"
  | "unknown";

export type DeployTarget = "firebase-hosting" | "cloud-run" | "firebase-functions";

export interface DetectedFrontend {
  type: string; // "vite-react" | "next-static" | "plain-html" | ...
  buildCommand?: string;
  outputDir: string;
}

export interface DetectedBackend {
  type: string; // "python-fastapi" | "node-express" | ...
  dockerfile: string;
  port: number;
}

export interface DetectedState {
  stack: StackType;
  frontend?: DetectedFrontend;
  backend?: DetectedBackend;
}

export interface FrontendTarget {
  service: "firebase-hosting";
  siteName: string;
}

export interface BackendTarget {
  service: "cloud-run";
  serviceName: string;
  region: string;
}

export interface WiringEdge {
  from: string; // "frontend.rewrites[/api/**]"
  to: string;   // "backend.cloudRun.url"
}

export interface Plan {
  version: 1;
  detected: DetectedState;
  targets: {
    frontend?: FrontendTarget;
    backend?: BackendTarget;
  };
  wiring: WiringEdge[];
  environment: Record<string, Record<string, string>>;
  deploymentOrder: Array<"frontend" | "backend">;
  checks: string[];
  warnings: string[];
}
