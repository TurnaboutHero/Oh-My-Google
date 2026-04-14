# oh-my-google (omg) — Product Requirements Document

> 버전: 0.3.0 (에이전트 퍼스트 리프레이밍)
> 최종 수정: 2026-04-14

---

## 1. 개요

**oh-my-google (omg)** 는 AI 에이전트가 Google 생태계를 안전하게, 똑똑하게 다루는 하네스다.

gcloud, firebase CLI 등 기존 Google CLI는 **사람용**이다. omg는 **에이전트용**이다.

| 사람용 CLI (gcloud/firebase) | 에이전트용 하네스 (omg) |
|---|---|
| 사람이 읽는 텍스트 출력 | 에이전트가 파싱하는 **JSON 출력** |
| 사용자가 판단해서 다음 명령 | **SKILL.md**가 다음 액션 가이드 |
| 실수하면 사람이 롤백 | **하드 하네스**가 자동 검증+롤백 |
| 세션 끊기면 처음부터 | **파이프라인 상태 영속**, 재시작 가능 |
| 각 도구 따로 배움 | `omg` 하나로 통합 |

- 특정 AI 코딩 툴의 플러그인이 아닌 **독립 CLI**
- 어떤 코딩 에이전트(Claude Code, Codex, OpenCode, Gemini CLI, Antigravity)에서든 호출 가능
- **서비스는 교체 가능한 부품, 하네스가 본체**
- npm 패키지: `oh-my-google` / CLI 명령어: `omg`

---

## 2. 배경 및 동기

### oh-my 시리즈 현황

| 플러그인 | 대상 툴 | 형태 |
|---|---|---|
| omc (oh-my-claudecode) | Claude Code | 플러그인 |
| omo (oh-my-openagent) | OpenCode | 플러그인 |
| omx (oh-my-codex) | Codex CLI | 플러그인 |
| oma (oh-my-antigravity) | Antigravity | 독립 CLI |
| **omg (oh-my-google)** | **툴 무관** | **독립 오케스트레이션 레이어** |

### oma의 한계 → omg 탄생 동기

- Antigravity가 서브에이전트를 지원하지 않아 워크플로우(순차 실행)만 가능
- oma CLI로 외부 조율을 시도했으나 진짜 오케스트레이션은 불가
- **oh-my-google에서 서브에이전트 기반 병렬 오케스트레이션 실현**

### 특정 툴 종속 리스크

- Gemini CLI: 무료 Flash만, Pro 제한 강화 (2026.03), 구독 연동 불완전
- Antigravity: 무료 쿼터 92% 감소 (250→20건/일), Pro/Ultra도 축소
- → **특정 Google 툴에 종속하지 않는 독립 레이어** 필요성 확인

---

## 3. 목표 / 비목표

### 목표

1. **에이전트 퍼스트 인터페이스** — 모든 출력이 JSON, 구조화된 에러, 에이전트가 파싱+판단 가능
2. **안전한 Google 서비스 호출** — 하드 하네스로 검증, 롤백, dry-run, 확인 게이트 강제
3. **어떤 코딩 에이전트에서든** 동일하게 동작 (Claude Code, Codex, OpenCode, Gemini CLI, Antigravity)
4. **파이프라인 상태 영속** — 에이전트 세션이 끊겨도 중간 상태 보존, 재시작 가능
5. **SKILL.md로 에이전트 가이드** — 에이전트가 "다음에 뭘 해야 하는지" 실질적 안내

### 비목표

- Gemini CLI/Antigravity의 대체가 아님 (공존)
- 마케팅 자동화 (MVP 범위 외, Pomelli 한국 미지원)
- Google Workspace 연동 (MVP 범위 외)
- 특정 코딩 에이전트 플러그인 개발 (어댑터로 지원)

---

## 4. 아키텍처

### 4.1 전체 구조

```
[어떤 에이전트든]          [omg CLI]           [Google 서비스]
Claude Code          →    omg deploy      →    Cloud Run (@google-cloud/run)
Codex                →    omg jules       →    Jules REST API (v1alpha)
OpenCode             →    omg stitch      →    Stitch (MCP/실험적)
Gemini CLI           →    omg db          →    Firebase CLI
Antigravity          →    ...             →    gcloud, googleapis SDK
```

### 4.2 하네스 구조: 소프트 + 하드 이중 레이어

```
소프트 레이어 (에이전트가 판단)
├── 사용자 의도 파악
├── 파이프라인 선택 ("배포만 해줘" vs "전체 다 해줘")
└── SKILL.md 기반 크로스플랫폼 스킬

    ↓ 소프트 레이어 출력: PipelineRequest (JSON)
    ↓ { pipeline: "deploy", steps: ["deploy"], params: {...} }

하드 레이어 (외부 통제)
├── PipelineRequest 수신 → 파이프라인 실행
├── 각 단계 pre/post 검증
├── 에러 시 재시도 또는 롤백
├── 비용 영향 있는 작업은 사용자 확인 요구
└── 인증/권한 관리
```

**이유**: Google 서비스 호출은 실제 과금, 배포, 계정에 영향. 에이전트가 스스로 판단하게 두면 안 됨.

### 4.3 CLI 스택 원칙: 2홉 이내

```
✅  에이전트 → omg → Google 서비스 (SDK, API, gcloud/firebase CLI)
❌  에이전트 → omg → Gemini CLI → Google 서비스  (3홉, 금지)
```

### 4.4 내부 연결 방식

각 Google 서비스마다 가장 적합한 연결 방식을 omg 내부에서 결정:

| 서비스 | 연결 방식 | 인증 | API 안정성 | 비고 |
|---|---|---|---|---|
| Cloud Run | `@google-cloud/run` SDK | GCP ADC (OAuth) | **GA** | MVP-alpha |
| Jules | REST API (`jules.googleapis.com/v1alpha`) | API 키 (`x-goog-api-key`) | **Alpha** | MVP-beta |
| Stitch | MCP 서버 (`stitch.googleapis.com/mcp`) + DESIGN.md export | MCP 인증 방식 미확인 | **실험적** (Google Labs, MCP 존재하나 문서 부족) | Phase 2 |
| Firebase | firebase CLI 실행 | GCP ADC | GA | Phase 2 |
| Cloud SQL | Cloud SQL Auth Proxy + DB 드라이버 | GCP ADC | GA | Phase 2 |
| BigQuery | `@google-cloud/bigquery` SDK | GCP ADC | GA | Phase 2 |

외부에서 보기엔 전부 `omg [command]`로 동일.

### 4.5 툴별 어댑터 지원 수준

| 에이전트 | 서브에이전트 | omg 지원 수준 |
|---|---|---|
| Claude Code | ✅ | 병렬 오케스트레이션 (Full) |
| OpenCode | ✅ | 병렬 오케스트레이션 (Full) |
| Codex | ✅ | 병렬 오케스트레이션 (Full) |
| Gemini CLI | ✅ | Tool Call 네이티브 (가장 깔끔) |
| Antigravity | ❌ (워크플로우만) | 순차 실행 (Degraded) |

→ **Claude Code 어댑터부터 구현**

### 4.6 어댑터 정의

어댑터는 **omg CLI를 특정 에이전트 환경에서 호출할 수 있게 만드는 통합 레이어**다.

| 어댑터 | 구체적 형태 | 설명 |
|---|---|---|
| Claude Code | SKILL.md + bash 래퍼 | 에이전트가 SKILL.md 읽고 `omg` CLI 실행 |
| Gemini CLI | Extension 정의 (Tool) | Gemini의 Extension 프레임워크에 Tool로 등록 |
| Antigravity | 워크플로우 YAML | Antigravity의 워크플로우 포맷으로 매핑 |

`skills/` = 소프트 하네스 (에이전트가 의도 파악에 사용)
`adapters/` = 해당 툴에서 omg를 호출하는 구체적 바인딩

---

## 5. 기술 스택

| 항목 | 선택 | 근거 |
|---|---|---|
| 언어 | TypeScript | oma 동일, googleapis SDK TS 퍼스트클래스, oh-my 시리즈 전체 TS/JS |
| 런타임 | Node.js (>=20) | npm 배포, 크로스플랫폼 |
| 빌드 | tsup | 빠른 번들링, ESM 출력 |
| 실행 | tsx (dev) | TS 직접 실행 |
| 패키지 매니저 | npm | npx 지원 필수 |
| CLI 프레임워크 | commander | 경량, 검증됨 |
| GCP 인증 | google-auth-library | ADC 기반 GCP 공식 |
| Cloud Run SDK | @google-cloud/run | Google 권장 Node 클라이언트 |
| Jules API | fetch/undici (직접 호출) | Alpha API, 공식 SDK 없음 |
| 크로스플랫폼 | bin/omg (Unix) + npm bin shim (Windows) | npm이 .cmd shim 자동 생성 |

---

## 6. MVP 범위

### 6.1 MVP 단계 분리

Critic 리뷰 + API 조사 결과, MVP를 둘로 분리:

**MVP-alpha**: CLI + 인증 + Cloud Run (가장 안정적인 GA API로 커넥터 패턴 확립)
**MVP-beta**: Jules 커넥터 추가 + 파이프라인 오케스트레이션

### 6.2 MVP-alpha 커맨드 명세

#### `omg setup`

GCP 프로젝트 설정 및 인증 초기화.

```
omg setup [--project-id <id>]

파라미터:
  --project-id    GCP 프로젝트 ID (생략 시 대화형 입력)

실행 흐름:
  1. GCP 프로젝트 ID 입력/확인
  2. gcloud auth application-default login 실행 (브라우저 OAuth)
  3. 프로젝트 접근 권한 확인
  4. ~/.omg/config.json에 프로젝트 ID 저장
  5. 사용 가능한 서비스 확인 (Cloud Run API enabled?)

출력:
  성공: "✓ Project <id> configured. Cloud Run API: enabled."
  실패: "✗ Cannot access project <id>. Check permissions."
```

#### `omg auth`

인증 상태 확인 및 갱신.

```
omg auth [status|refresh|logout]

서브커맨드:
  status    현재 인증 상태 표시 (기본)
  refresh   토큰 갱신
  logout    저장된 인증 정보 삭제

출력 (status):
  Project: my-project-123
  GCP ADC: ✓ authenticated (expires: 2026-04-15T10:00:00Z)
  Jules API Key: ✓ configured
  Cloud Run: ✓ accessible
```

#### `omg doctor`

전체 연결 상태 진단.

```
omg doctor

실행 흐름:
  1. config.json 존재 확인
  2. GCP ADC 토큰 유효성 확인
  3. 각 커넥터 healthCheck() 실행
  4. 필요한 CLI 도구 확인 (gcloud 설치 여부)

출력:
  ✓ Config: ~/.omg/config.json found
  ✓ GCP Auth: valid (project: my-project-123)
  ✓ Cloud Run: API enabled, permissions OK
  ⚠ Jules: API key not configured (run: omg jules setup)
  ✗ gcloud CLI: not found (required for some operations)
```

#### `omg deploy`

Cloud Run에 서비스 배포.

```
omg deploy [--service <name>] [--region <region>] [--source <path>] [--dry-run]

파라미터:
  --service    서비스명 (생략 시 package.json name 사용)
  --region     배포 리전 (기본: config에서 읽음, 없으면 대화형)
  --source     소스 경로 (기본: 현재 디렉토리)
  --dry-run    실제 배포하지 않고 계획만 표시

실행 흐름:
  1. 인증 확인 (AuthError → "omg setup 먼저 실행하세요")
  2. 소스 디렉토리 검증 (Dockerfile 또는 buildpack 설정 확인)
  3. --dry-run이면 배포 계획만 표시하고 종료
  4. 사용자 확인: "Deploy <service> to <region>? (y/N)"
  5. @google-cloud/run SDK로 배포 실행
  6. 배포 상태 폴링 (진행률 표시)
  7. 완료 시 서비스 URL 표시

출력:
  성공: "✓ Deployed: https://my-app-abc123.run.app"
  실패: "✗ Deploy failed: <error>. Run 'omg deploy logs' for details."

서브커맨드:
  omg deploy status    현재 배포 상태
  omg deploy logs      최근 배포 로그
  omg deploy rollback  이전 리비전으로 롤백
```

#### `omg status`

현재 작업 상태 확인.

```
omg status

출력:
  Project: my-project-123
  Cloud Run Services:
    my-app (asia-northeast3): ✓ serving, 2 revisions
  Jules Tasks:
    (no active tasks)
  Pipeline:
    (no running pipeline)
```

### 6.3 MVP-beta 추가 커맨드 명세

#### `omg jules`

Jules 비동기 코딩 에이전트 작업 관리.

```
omg jules setup                        API 키 설정
omg jules submit <prompt> [--repo <url>]  작업 제출
omg jules status [<task-id>]           작업 상태 확인
omg jules result [<task-id>]           결과 확인 (PR URL 등)
omg jules list                         활성 작업 목록
omg jules cancel <task-id>             작업 취소

인증: Jules API 키 (x-goog-api-key)
API: jules.googleapis.com/v1alpha

omg jules submit 실행 흐름:
  1. API 키 확인 (없으면 "omg jules setup" 안내)
  2. 레포 URL 확인 (--repo 또는 현재 git remote)
  3. 세션 생성 (POST /v1alpha/sessions)
  4. 세션 ID 반환 및 로컬 상태 저장
  5. "Task submitted: <session-id>. Run 'omg jules status' to check."

omg jules status 실행 흐름:
  1. 세션 상태 조회 (GET /v1alpha/sessions/<id>)
  2. 활동 목록 조회 (GET /v1alpha/sessions/<id>/activities)
  3. 진행 상태 표시

omg jules result 실행 흐름:
  1. 세션 완료 확인
  2. 소스 출력 조회 (GET /v1alpha/sessions/<id>/sources)
  3. PR URL 또는 변경사항 표시
```

#### `omg pipeline`

파이프라인 오케스트레이션.

```
omg pipeline [<name>] [--from <step>] [--only <step>] [--dry-run]

파라미터:
  <name>      파이프라인 이름 (기본: "code-to-deploy")
  --from      특정 단계부터 실행
  --only      특정 단계만 실행
  --dry-run   실행 계획만 표시

내장 파이프라인:
  code-to-deploy: Jules로 코딩 → Cloud Run 배포

실행 흐름:
  1. 파이프라인 정의 로드
  2. --dry-run이면 실행 계획 표시 후 종료
  3. 각 단계별:
     a. 사전 검증 (이전 단계 결과 확인)
     b. 사용자 확인 (비용/배포 영향 있는 단계)
     c. 커넥터 실행
     d. 사후 검증 (성공 여부)
     e. 실패 시: 롤백 가능하면 롤백, 아니면 중단
  4. 전체 결과 요약

출력:
  Pipeline: code-to-deploy
  [1/2] Jules submit... ✓ (session: abc-123)
  [1/2] Jules polling... ✓ (completed, PR: github.com/...)
  [2/2] Cloud Run deploy... ✓ (https://my-app.run.app)
  ✓ Pipeline complete.
```

### 6.4 Phase 2 (MVP 이후)

- Stitch 커넥터 (API 안정화 후)
- Firebase 커넥터
- Cloud SQL / BigQuery 커넥터
- Flutter 빌드 + Google Play 배포
- Gemini CLI / Antigravity 어댑터

### 6.5 Phase 3 (장기)

- Pomelli 마케팅 (한국 지원 시)
- Google Ads / Analytics 연동
- Google Workspace 연동
- Vertex AI 연동
- NotebookLM 연동

---

## 7. 인증 아키텍처

### 7.1 서비스별 인증 프로바이더 패턴

"GCP 프로젝트 ID 하나로 전체 통합"이 아닌, **서비스별 인증 프로바이더**를 두되 공통 관리:

```
AuthManager
├── GcpAuthProvider    (ADC 기반: Cloud Run, Firebase, BigQuery...)
├── JulesAuthProvider  (API 키 기반: Jules REST API)
└── StitchAuthProvider (TBD: Stitch 인증 확인 후 추가)
```

| 서비스 | 인증 방식 | 저장 위치 |
|---|---|---|
| Cloud Run | GCP ADC (OAuth2, `gcloud auth application-default login`) | `~/.config/gcloud/application_default_credentials.json` |
| Jules | API 키 (`x-goog-api-key`, jules.google.com/settings에서 발급) | `~/.omg/credentials.json` |
| Firebase | GCP ADC (동일) | GCP ADC 공유 |
| Stitch | 미확인 (API 공개 시 추가) | TBD |

### 7.2 설정 파일 구조

```
~/.omg/
├── config.json         # { projectId, region, defaultService }
├── credentials.json    # Jules API 키 등 non-ADC 인증 정보
└── state/
    └── pipelines/      # 파이프라인 실행 상태 (재시작용)
```

`config.json` 스키마:
```json
{
  "projectId": "my-project-123",
  "region": "asia-northeast3",
  "jules": {
    "apiKey": "...",
    "defaultRepo": "https://github.com/user/repo"
  }
}
```

### 7.3 인증 흐름

```
omg setup
  ├─ 1. GCP 프로젝트 ID 입력
  ├─ 2. gcloud auth application-default login (브라우저 OAuth)
  ├─ 3. Cloud Run API 활성화 확인
  └─ 4. config.json 저장

omg jules setup
  ├─ 1. jules.google.com/settings 안내
  ├─ 2. API 키 입력
  └─ 3. credentials.json에 저장
```

---

## 8. 안전 가드레일

### 8.1 비용/영향 보호

Google 서비스 호출은 과금, 배포, 계정에 영향. 다음 안전장치 필수:

| 가드레일 | 적용 대상 | 동작 |
|---|---|---|
| `--dry-run` | deploy, pipeline | 실행 계획만 표시, 실제 호출 안 함 |
| 사용자 확인 프롬프트 | deploy, pipeline 내 배포 단계 | "Deploy to production? (y/N)" |
| 자동 확인 플래그 | 모든 확인 대상 | `--yes` 또는 `-y`로 스킵 (CI/CD용) |
| 타임아웃 | 모든 커넥터 | 기본 5분, 설정 가능 |

### 8.2 에러 처리 모델

```
에러 발생
  │
  ├─ AuthError (인증 만료/미설정)
  │   → 전체 중단, "omg setup" 또는 "omg auth refresh" 안내
  │
  ├─ QuotaError (쿼터 초과)
  │   → 대기 후 재시도 (지수 백오프, 최대 3회)
  │
  ├─ ApiError (5xx 서버 에러)
  │   → 1회 재시도 후 중단
  │
  ├─ ApiError (4xx 클라이언트 에러)
  │   → 즉시 중단, 원인 표시
  │
  ├─ TimeoutError
  │   → 1회 재시도 후 중단
  │
  └─ ValidationError (사후 검증 실패)
      → 롤백 가능하면 롤백 → 중단
      → 롤백 불가하면 경고 표시 → 중단

커넥터별 롤백 가능 여부:
  Cloud Run: ✅ (이전 리비전 복원)
  Jules: ⚠️ (세션 취소 가능, PR은 수동 닫기)
  Stitch: ❌ (생성된 디자인 삭제 불가 가정)
```

### 8.3 로깅

```
omg --verbose <command>    상세 로그 출력
omg --debug <command>      API 요청/응답 전체 출력

로그 저장: ~/.omg/logs/<date>.log (최근 7일 보관)
```

---

## 9. 스킬 시스템

- **SKILL.md 기반** — 크로스플랫폼, 어느 에이전트에서든 읽힘
- **서비스별 스킬** (빌딩블록): deploy, jules 각각
- **파이프라인 스킬** (오케스트레이션): 전체 흐름 묶음
- 사용자가 개별 스킬 직접 호출도 가능
- omg가 전체 파이프라인을 제안할 수도 있음

---

## 10. 프로젝트 구조

```
oh-my-google/
├── bin/
│   └── omg              CLI 진입점 (npm bin shim이 Windows 처리)
├── src/
│   ├── cli/             CLI 명령어 정의 (commander)
│   │   ├── index.ts     진입점
│   │   ├── setup.ts
│   │   ├── auth.ts
│   │   ├── doctor.ts
│   │   └── commands/
│   │       ├── deploy.ts
│   │       ├── jules.ts
│   │       └── pipeline.ts
│   ├── auth/            인증 통합
│   │   ├── auth-manager.ts     인증 프로바이더 총괄
│   │   ├── gcp-provider.ts     GCP ADC 기반 (Cloud Run, Firebase...)
│   │   ├── jules-provider.ts   Jules API 키 기반
│   │   └── token-store.ts      인증 정보 저장/로드
│   ├── connectors/      각 Google 서비스 연결 (하드 레이어)
│   │   ├── base.ts      공통 Connector/AsyncConnector 인터페이스
│   │   ├── cloud-run.ts
│   │   └── jules.ts
│   ├── orchestrator/    파이프라인 오케스트레이션 (하드 레이어)
│   │   ├── pipeline.ts  PipelineExecutor
│   │   ├── validator.ts 단계 검증
│   │   └── pipelines/   내장 파이프라인 정의
│   │       └── code-to-deploy.ts
│   ├── adapters/        툴별 어댑터
│   │   └── claude-code/
│   │       └── skills/  Claude Code용 SKILL.md
│   └── types/           공통 타입 정의
│       ├── connector.ts
│       ├── pipeline.ts
│       └── errors.ts
├── skills/              크로스플랫폼 SKILL.md (소프트 레이어)
│   ├── omg-setup/
│   │   └── SKILL.md
│   ├── deploy/
│   │   └── SKILL.md
│   ├── jules/
│   │   └── SKILL.md
│   └── pipeline/
│       └── SKILL.md
├── tests/
│   ├── unit/            단위 테스트
│   ├── integration/     통합 테스트 (실제 API, CI에서만)
│   └── mocks/           Google API mock 응답
├── docs/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── CLAUDE.md
├── PRD.md
├── ARCHITECTURE.md
└── README.md
```

---

## 11. 테스트 전략

| 레이어 | 테스트 방식 | Mock 여부 |
|---|---|---|
| `auth/` | 단위 테스트 | Mock (토큰 발급/갱신 시뮬레이션) |
| `connectors/` | 단위: mock API 응답 / 통합: 실제 API 호출 | 단위는 mock, 통합은 real |
| `orchestrator/` | 단위 테스트 (mock 커넥터 주입) | Mock |
| `cli/` | E2E (실제 CLI 실행, mock 커넥터) | Mock |

- **CI**: 단위 테스트 + mock 기반 통합 테스트
- **수동 검증**: 실제 GCP 프로젝트로 E2E (릴리스 전)
- **테스트 프레임워크**: vitest

---

## 12. 구현 로드맵

### MVP-alpha: CLI + 인증 + Cloud Run

| 순서 | 작업 | 수용 기준 |
|---|---|---|
| 1 | 프로젝트 스캐폴딩 | `npm run build` 성공, `omg --help` 동작 |
| 2 | Connector 인터페이스 정의 | `base.ts`에 Connector/AsyncConnector 타입 |
| 3 | AuthManager + GcpProvider | `omg setup` → ADC 토큰 저장 → `omg auth status` 확인 |
| 4 | `omg doctor` | 각 커넥터 healthCheck 결과 표시 |
| 5 | Cloud Run 커넥터 | `omg deploy --dry-run` → 계획 표시, `omg deploy` → 실제 배포 |
| 6 | 테스트 | Cloud Run 커넥터 단위 테스트 통과 |

### MVP-beta: Jules + 파이프라인

| 순서 | 작업 | 수용 기준 |
|---|---|---|
| 7 | JulesAuthProvider | `omg jules setup` → API 키 저장 |
| 8 | Jules 커넥터 | `omg jules submit` → 세션 생성 → `omg jules status` → 상태 표시 |
| 9 | PipelineExecutor | `omg pipeline code-to-deploy --dry-run` → 계획 표시 |
| 10 | Claude Code 어댑터 | SKILL.md에서 omg 명령어 호출 가능 |
| 11 | SKILL.md + README | 문서화 완료 |

### Phase 2: 확장

- Stitch 커넥터 (API 안정화 후)
- Firebase, Cloud SQL, BigQuery 커넥터
- Gemini CLI, Antigravity 어댑터
- Flutter + Google Play 배포 파이프라인

### Phase 3: 장기

- 마케팅 레이어 (Pomelli/Google Ads)
- Workspace 연동
- Vertex AI, NotebookLM

---

## 13. 리스크 및 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| Stitch API 미공개 상태 지속 | 디자인 단계 연동 불가 | MVP에서 제외, Phase 2로 이동. Figma MCP 등 대안 검토 |
| Jules API가 alpha에서 변경 | 커넥터 파손 | API 버전 pinning + 변경 감지 테스트 |
| Google Labs 제품 종료 | 커넥터 무용화 | 커넥터 인터페이스로 격리, 제거/교체 용이하게 |
| npm 패키지명 상표 이슈 | 배포 차단 | `omg-cli` 또는 `@omg/cli` scoped 패키지로 전환 대비 |

---

## 14. oma와의 관계

- oma는 유지 (Antigravity 전용, 수정 필요)
- oh-my-google은 별개 프로젝트
- oma에서 못 했던 서브에이전트 오케스트레이션을 oh-my-google에서 실현
- 장기적으로 Antigravity 어댑터를 통해 oma 사용자도 omg 활용 가능

---

*v0.2.0 — Critic 리뷰 3 critical + 4 major 반영, Codex API 조사 결과 반영.*
