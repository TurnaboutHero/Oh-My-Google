/**
 * GCP 프로젝트 선택/생성.
 *
 * TODO(codex):
 * - listProjects(): Promise<{projectId, name}[]>  (gcloud projects list --format=json)
 * - createProject(projectId, name): Promise<void> (gcloud projects create)
 * - setActiveProject(projectId): Promise<void>    (gcloud config set project)
 * 에러는 OmgError 계층으로 래핑 (NO_AUTH, PROJECT_EXISTS, QUOTA_EXCEEDED 등).
 */

export interface GcpProject {
  projectId: string;
  name: string;
  lifecycleState?: string;
}

export async function listProjects(): Promise<GcpProject[]> {
  throw new Error("Not implemented");
}

export async function createProject(_projectId: string, _name?: string): Promise<void> {
  throw new Error("Not implemented");
}

export async function setActiveProject(_projectId: string): Promise<void> {
  throw new Error("Not implemented");
}
