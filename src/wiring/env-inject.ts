/**
 * Plan.environment → Cloud Run env vars / Firebase config 주입.
 *
 * TODO(codex):
 * - resolveEnv(env, projectId): Secret 참조(${SECRET:KEY}) 해결
 * - injectCloudRunEnv(serviceName, env)
 */

export async function resolveEnv(
  _env: Record<string, string>,
  _projectId: string,
): Promise<Record<string, string>> {
  throw new Error("Not implemented");
}
