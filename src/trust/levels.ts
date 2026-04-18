/**
 * Action → TrustLevel 매핑.
 * 모든 커맨드/액션은 여기서 레벨을 받아 checkPermission을 통과해야 함.
 *
 * TODO(codex): 각 커맨드에서 호출하는 액션 이름과 레벨 매핑 확정.
 */

import type { TrustLevel } from "../types/trust.js";

export const ACTION_LEVELS: Record<string, TrustLevel> = {
  // L0 — 읽기/조회
  "gcp.projects.list": "L0",
  "gcp.auth.status": "L0",
  "planner.detect": "L0",
  "doctor.run": "L0",
  "secret.list": "L0",

  // L1 — 배포/설정 변경
  "deploy.cloud-run": "L1",
  "deploy.firebase-hosting": "L1",
  "apis.enable": "L1",
  "firebase.rewrites.update": "L1",

  // L2 — IAM/빌링/프로덕션
  "iam.role.grant": "L2",
  "billing.link": "L2",
  "deploy.prod": "L2",
  "secret.set": "L2",

  // L3 — 삭제/고위험
  "gcp.project.delete": "L3",
  "firestore.data.delete": "L3",
};

export function getLevel(action: string): TrustLevel {
  return ACTION_LEVELS[action] ?? "L2"; // unknown → 보수적
}
