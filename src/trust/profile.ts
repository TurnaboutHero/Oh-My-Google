/**
 * Trust Profile 로드/저장.
 * 경로: `.omg/trust.yaml` (프로젝트 단위).
 *
 * TODO(codex): Implement load/save/generate with yaml + fs/promises.
 * - load(cwd): TrustProfile | null
 * - save(cwd, profile): void
 * - generateDefault(projectId, environment): TrustProfile — 가장 보수적 기본값
 */

import type { TrustProfile } from "../types/trust.js";

export async function loadProfile(_cwd: string): Promise<TrustProfile | null> {
  throw new Error("Not implemented");
}

export async function saveProfile(_cwd: string, _profile: TrustProfile): Promise<void> {
  throw new Error("Not implemented");
}

export function generateDefaultProfile(
  _projectId: string,
  _environment: TrustProfile["environment"],
): TrustProfile {
  throw new Error("Not implemented");
}
