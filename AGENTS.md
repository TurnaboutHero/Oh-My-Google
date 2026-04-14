# AGENTS.md — How AI Agents Should Use omg

> 이 문서는 AI 코딩 에이전트(Claude Code, Codex, OpenCode, Gemini CLI, Antigravity 등)가
> oh-my-google (omg) CLI를 사용하는 방법을 안내합니다.

## omg란?

omg는 AI 에이전트가 Google 생태계(Cloud Run, Firebase, Jules 등)를 **안전하게** 다루는 하네스입니다.
gcloud/firebase CLI는 사람용이고, omg는 에이전트용입니다.

## 핵심 원칙

1. **항상 `--output json` 사용** — 에이전트는 JSON 출력을 파싱해서 다음 액션을 결정
2. **`--dry-run` 먼저** — 배포/변경 전에 항상 dry-run으로 계획 확인
3. **`next` 필드 따라가기** — 모든 응답에 다음에 할 일이 포함됨
4. **`error.code`로 분기** — 에러 메시지가 아닌 에러 코드로 대응 결정

## 출력 형식

모든 omg 명령어는 `--output json` 시 동일한 구조 반환:

```json
{
  "ok": true,
  "command": "deploy:dry-run",
  "data": {
    "projectId": "my-project",
    "service": "my-app",
    "region": "asia-northeast3"
  },
  "next": [
    "omg deploy --yes"
  ]
}
```

에러 시:

```json
{
  "ok": false,
  "command": "deploy",
  "error": {
    "code": "AUTH_ERROR",
    "message": "Not authenticated.",
    "recoverable": false,
    "hint": "Run 'omg setup' first."
  }
}
```

## 에러 코드 대응표

| error.code | 의미 | 에이전트 대응 |
|---|---|---|
| `AUTH_ERROR` | 인증 안 됨 | `omg setup` 실행 요청 |
| `NO_PROJECT` | 프로젝트 미설정 | `omg setup --project-id <id>` 실행 |
| `DEPLOY_FAILED` | 배포 실패 | `omg deploy logs`로 원인 확인 |
| `CANCELLED` | 사용자가 취소 | 다른 접근 제안 |
| `REFRESH_FAILED` | 토큰 갱신 실패 | `omg setup` 재실행 요청 |
| `STATUS_ERROR` | 상태 조회 실패 | 재시도 가능 (recoverable: true) |
| `QUOTA_EXCEEDED` | API 할당량 초과 | 대기 후 재시도 |
| `VALIDATION_ERROR` | 입력값 검증 실패 | 파라미터 수정 |
| `POLICY_VIOLATION` | 2홉 규칙 위반 등 | 허용된 방식으로 재시도 |

## 표준 워크플로우

### 1. 초기 설정

```bash
# 1. 프로젝트 설정 + GCP 인증
omg setup --project-id my-project

# 2. 연결 상태 확인
omg --output json doctor

# 3. doctor 결과의 next 필드 따라가기
```

### 2. Cloud Run 배포

```bash
# 1. 항상 dry-run 먼저
omg --output json deploy --dry-run --service my-app --region asia-northeast3

# 2. ok: true 확인 후 실제 배포
omg --output json deploy --yes --service my-app --region asia-northeast3

# 3. 배포 확인
omg --output json deploy status --service my-app
```

### 3. Firebase 배포

```bash
# 1. 프로젝트 초기화
omg --output json firebase init

# 2. 로컬 에뮬레이터로 테스트
omg --output json firebase emulators

# 3. dry-run
omg --output json firebase deploy --dry-run

# 4. 실제 배포
omg --output json firebase deploy --yes
```

## 에이전트 통합 패턴

### 패턴 1: 결과 기반 분기

```
1. omg --output json <command> 실행
2. JSON 파싱
3. ok === true → data 활용, next 따라가기
4. ok === false → error.code 매칭
   - recoverable === true → 재시도 가능
   - recoverable === false → 사용자에게 안내
```

### 패턴 2: 단계별 검증

```
1. omg --output json deploy --dry-run  → 계획 확인
2. 사용자에게 계획 보여주고 승인 받기
3. omg --output json deploy --yes      → 실행
4. omg --output json deploy status     → 검증
```

### 패턴 3: 파이프라인

```
1. omg --output json pipeline --dry-run  → 전체 계획
2. omg --output json pipeline --yes      → 단계별 실행 (하드 하네스가 통제)
3. omg --output json status              → 결과 확인
```

## JSON 모드에서의 확인 게이트

`--output json` 모드에서는 interactive confirmation이 자동 스킵됩니다.
에이전트가 배포를 원하면 반드시 `--yes` 플래그를 명시적으로 추가해야 합니다.

**안전 순서**: `--dry-run` → 결과 확인 → `--yes`

## 커맨드 레퍼런스

```
omg setup [--project-id <id>]           GCP 프로젝트 설정 + 인증
omg auth                                인증 상태 확인
omg auth refresh                        토큰 갱신
omg auth logout                         인증 정보 삭제
omg doctor                              전체 연결 진단
omg deploy [--dry-run] [--yes]          Cloud Run 배포
omg deploy status                       배포 상태
omg deploy logs                         배포 로그
omg firebase init                       Firebase 프로젝트 초기화
omg firebase deploy [--dry-run] [--yes] Firebase 배포
omg firebase emulators                  로컬 에뮬레이터 실행
omg pipeline [--dry-run] [--yes]        파이프라인 실행
omg status                              현재 작업 상태
```

모든 커맨드에 `--output json` 글로벌 옵션 사용 가능.
