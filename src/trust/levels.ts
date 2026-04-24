import type { TrustLevel } from "../types/trust.js";

export const ACTION_LEVELS: Record<string, TrustLevel> = {
  // L0 read-only actions
  "gcp.projects.list": "L0",
  "gcp.auth.status": "L0",
  "planner.detect": "L0",
  "doctor.run": "L0",
  "project.audit": "L0",
  "project.cleanup.plan": "L0",
  "billing.audit": "L0",
  "firestore.audit": "L0",
  "iam.audit": "L0",
  "security.audit": "L0",
  "secret.list": "L0",
  "sql.audit": "L0",
  "storage.audit": "L0",

  // L1 deployment and configuration changes
  "deploy.cloud-run": "L1",
  "deploy.firebase-hosting": "L1",
  "apis.enable": "L1",
  "budget.enable-api": "L1",
  "firebase.rewrites.update": "L1",

  // L2 IAM, billing, production, and secret writes
  "iam.role.grant": "L2",
  "billing.link": "L2",
  "deploy.prod": "L2",
  "secret.set": "L2",

  // L3 destructive or high-risk lifecycle actions
  "secret.delete": "L3",
  "gcp.project.delete": "L3",
  "gcp.project.undelete": "L3",
  "firestore.data.delete": "L3",
};

export function getLevel(action: string): TrustLevel {
  return ACTION_LEVELS[action] ?? "L2";
}
