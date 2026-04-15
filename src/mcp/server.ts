/**
 * MCP 서버 진입.
 * 각 CLI 커맨드를 MCP tool로 노출 (같은 core 호출).
 *
 * TODO(codex, Phase 1.4):
 * - @modelcontextprotocol/sdk 기반
 * - stdio/sse 모드
 * - Trust Profile을 context로 노출
 * - 각 tool I/O는 CLI JSON 결과와 동일 포맷
 */

export async function startMcpServer(_opts: { transport: "stdio" | "sse" }): Promise<void> {
  throw new Error("Not implemented — Phase 1.4");
}
