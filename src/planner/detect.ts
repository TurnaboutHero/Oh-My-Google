/**
 * Repo 스캔 → DetectedState 생성.
 *
 * TODO(codex):
 * - detect(cwd): DetectedState
 *   - Dockerfile → backend 후보
 *   - package.json scripts.build → frontend 후보
 *   - firebase.json → 기존 Firebase 설정
 *   - next.config.js → WARN (Vercel 권장)
 *   - public/ + index.html → static
 *   - functions/ → Firebase Functions
 */

import type { DetectedState } from "../types/plan.js";

export async function detect(_cwd: string): Promise<DetectedState> {
  throw new Error("Not implemented");
}
