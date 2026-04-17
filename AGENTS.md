# AGENTS.md — How AI Agents Should Use omg

이 문서는 AI 코딩 에이전트(Claude Code, Codex, Gemini CLI, Antigravity 등)가 oh-my-google (`omg`)을 사용하는 방법을 안내합니다.

## omg란?

omg는 AI 에이전트가 Google Cloud + Firebase를 **하나의 프로젝트**로 안전하게 다루는 하네스입니다. 두 서비스의 경계(별도 CLI, 별도 auth, 별도 console)를 통합 진입점으로 묶고, Trust Profile이 자동/승인 결정을 내립니다.

**이중 surface**: 에이전트는 다음 둘 중 하나로 omg를 씁니다.

1. **CLI** — `omg --output json <command>`
2. **MCP** — `omg mcp start`로 stdio 서버를 띄우고 7개 tool 호출

둘은 동일한 shared core를 호출하므로 응답 계약이 같습니다.

## 핵심 원칙

1. **JSON 모드 또는 MCP tool** — 사람용 human 출력은 파싱 금지.
2. **Trust Profile이 결정** — 에이전트가 임의 판단 금지. `require_approval`을 만나면 사람 승인을 기다림.
3. **`next` 필드 따라가기** — 모든 응답의 `next` 배열이 다음 행동.
4. **`error.code`로 분기** — 에러 메시지가 아닌 코드 기준.
5. **`--dry-run` 먼저** — 배포 전 반드시 계획 확인.

## 응답 형식

모든 응답은 동일한 구조를 사용합니다.

```json
{
  "ok": true,
  "command": "<name>",
  "data": { },
  "error": { "code": "", "message": "", "recoverable": true, "hint": "" },
  "next": [""]
}
```

MCP tool 응답은 이 객체를 `content[0].text`에 JSON 문자열로 실어 반환합니다.

## MCP tool

| Tool | Input | 의미 |
|---|---|---|
| `omg.init` | `projectId`, `billingAccount`, `environment`, `region` | 프로젝트/Trust Profile 초기화 |
| `omg.link` | `region?`, `service?`, `site?` | 리포 감지 후 Plan 생성 |
| `omg.deploy` | `dryRun?`, `approval?`, `yes?` | Trust gate + approval 경로를 거쳐 배포 |
| `omg.doctor` | — | 연결 상태 진단 |
| `omg.approve` | `approvalId`, `reason?`, `approver?` | Approval 승인 |
| `omg.reject` | `approvalId`, `reason?`, `rejecter?` | Approval 거부 |
| `omg.approvals.list` | `status?`, `action?` | Approval 목록 조회 |

## 표준 워크플로우

### 초기 설정

```
omg.doctor → 현재 상태 점검
omg.init { projectId, billingAccount, environment, region } → 프로젝트 준비
omg.link {} → 리포 감지 + Plan 생성
```

### 배포 (dev 환경, 승인 불필요)

```
omg.deploy { dryRun: true } → plan 확인
omg.deploy { yes: true } → 실제 배포
```

### 배포 (prod 환경, require_approval)

```
omg.deploy {} → ok:false, error.code="APPROVAL_REQUIRED", data.approvalId 획득
# 사람이 omg approve <id> 실행 (또는 .omg/approvals/<id>.yaml 직접 수정)
omg.approvals.list { status: "approved" } → 승인 확인
omg.deploy { approval: "<id>" } → 실행 (argsHash 검증 후 consumed)
```

## 에러 코드 대응표

| `error.code` | 의미 | 대응 |
|---|---|---|
| `VALIDATION_ERROR` | 입력 검증 실패 | 파라미터 수정 |
| `NO_PROJECT`, `NO_BILLING`, `NO_AUTH` | 설정 누락 | `omg.init` 실행 |
| `NO_PLAN` | plan 파일 없음 | `omg.link` 먼저 |
| `NO_TRUST_PROFILE` | trust profile 없음 | `omg.init` 먼저 |
| `NO_DEPLOYABLE_CONTENT` | 감지 실패 | 리포에 Dockerfile/package.json 등 필요 |
| `TRUST_DENIED` | Trust가 거부 | Trust Profile 조정 필요 |
| `TRUST_REQUIRES_CONFIRM` | JSON 모드 `--yes` 필요 | `yes: true` 또는 `--yes` 재실행 |
| `APPROVAL_REQUIRED` | 사람 승인 필요 | `data.approvalId` 보존 → 사람 승인 후 재실행 |
| `APPROVAL_NOT_FOUND` | 전달한 id 파일 없음 | id 확인 |
| `APPROVAL_NOT_APPROVED` | 아직 승인 전 | `omg.approve` 필요 |
| `APPROVAL_EXPIRED` | TTL 경과 | 새 approval 생성 (deploy 재시도 시 자동) |
| `APPROVAL_MISMATCH` | action/argsHash 불일치 | 승인받은 설정으로 배포하거나 새 approval |
| `APPROVAL_CONSUMED` | 이미 사용된 id | 새 approval 필요 |
| `APPROVAL_ALREADY_FINALIZED` | approve/reject 대상이 pending 아님 | 상태 확인 |

## 안전 규칙

- `require_approval` 단계의 approval은 **1회용**. 한 번 `consumed`되면 새 approval을 만들어야 함.
- `argsHash`는 배포 인자 전체(service/region/image/port/runtime/envKeys 등)의 정규화 + sha256. 승인 후 인자 변경 시 `APPROVAL_MISMATCH`로 거부.
- MCP는 stdio 기반이라 human confirmation 불가. `require_confirm`은 `yes: true` 명시로만 통과.
- `deny` 규칙은 우회 불가 — Trust Profile 직접 수정이 필요.

## 커맨드/도구 레퍼런스

CLI:

```
omg init [--project --billing --environment --region --yes]
omg link [--region --service --site]
omg deploy [--dry-run] [--yes] [--approval <id>]
omg doctor
omg approve <id> [--reason <text>]
omg reject <id> [--reason <text>]
omg approvals list [--status <s>] [--action <a>]
omg mcp start
```

모든 CLI 명령에 `--output json` 글로벌 옵션 사용 가능.

MCP: 위 MCP tool 표 참조. stdio 기반으로 `omg mcp start`가 서버를 기동합니다.
