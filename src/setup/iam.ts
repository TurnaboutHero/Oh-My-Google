/**
 * IAM 기본 세팅.
 * Propose → Execute 2단계. trust/check.checkPermission 통과 필수.
 *
 * TODO(codex):
 * - proposeDefaultRoles(projectId): ProposedBinding[]
 * - applyBindings(projectId, bindings): Promise<void>
 * - getBindings(projectId, principal): 현재 역할 조회
 */

export interface ProposedBinding {
  principal: string; // "user:x@y.com" | "serviceAccount:..."
  role: string;      // "roles/run.admin"
  reason: string;    // 왜 필요한지
}

export async function proposeDefaultRoles(_projectId: string): Promise<ProposedBinding[]> {
  throw new Error("Not implemented");
}

export async function applyBindings(_projectId: string, _bindings: ProposedBinding[]): Promise<void> {
  throw new Error("Not implemented");
}
