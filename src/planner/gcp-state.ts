/**
 * 현재 GCP 프로젝트 상태 조회.
 *
 * TODO(codex):
 * - fetchGcpState(projectId): 활성 API, Cloud Run 서비스, Firebase 연결 여부
 */

export interface GcpState {
  projectId: string;
  enabledApis: string[];
  cloudRunServices: Array<{ name: string; region: string; url?: string }>;
  firebaseLinked: boolean;
  region?: string;
}

export async function fetchGcpState(_projectId: string): Promise<GcpState> {
  throw new Error("Not implemented");
}
