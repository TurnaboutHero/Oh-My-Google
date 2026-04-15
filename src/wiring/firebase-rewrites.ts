/**
 * Cloud Run URL → firebase.json rewrites 자동 주입.
 * MVP의 킬러 기능.
 *
 * TODO(codex):
 * - injectRewrite(cwd, pattern, serviceName, region): firebase.json 수정
 * - 기존 rewrites 보존, 같은 pattern만 교체
 * - diff 반환 (preview용)
 */

export interface RewriteEdge {
  pattern: string;      // "/api/**"
  serviceName: string;  // Cloud Run service
  region: string;
}

export async function injectRewrite(_cwd: string, _edge: RewriteEdge): Promise<{ diff: string }> {
  throw new Error("Not implemented");
}
