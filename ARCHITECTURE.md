# oh-my-google (omg) — Architecture

> 버전: 1.0.0 (PRD v1.0 정렬)
> 최종 수정: 2026-04-15

---

## 1. 설계 원칙

1. **GCP + Firebase 통합 레이어**: 두 CLI(`gcloud` + `firebase`), 두 auth, 두 console을 **한 진입점**으로.
2. **4-command MVP**: `init` / `link` / `deploy` / `doctor`. admin surface는 Phase 2.
3. **Setup-time intense + Runtime hands-off**: init 1회 승인으로 Trust Profile 생성 → 이후 profile 따라 자동/승인 결정.
4. **에이전트 자체 판단 금지**: Trust Profile이 결정. 에이전트는 따를 뿐.
5. **Planner > Executor**: 실행 전 "무엇을 어디에 어떻게"를 먼저 결정. 실행기는 단순.
6. **Cross-service wiring**: Cloud Run URL → Firebase rewrites 자동 연결이 핵심 가치.
7. **No premature abstraction**: Pipeline/Adapter 추상화 금지. 동일 패턴 3회 반복 후 등장.
8. **Agent-first output**: 모든 출력 JSON 구조화 (`ok/command/data/error/next`).
9. **Dual surface**: CLI + MCP 서버 둘 다 같은 core 호출. 로직 중복 없음.

---

## 2. 레이어 모델

```
┌────────────────────┬────────────────────┐
│  CLI (commander)   │  MCP Server        │   ← 진입점 (dual surface)
│  bin/omg, omg ...  │  omg mcp-serve     │
└─────────┬──────────┴──────────┬─────────┘
          │                     │
          └──────────┬──────────┘
                     ▼
┌──────────────────────────────────────────────────┐
│  Core (library)                                   │
├──────────────────────────────────────────────────┤
│  Output (JSON/Human) + Safety Gate                │
├──────────────────────────────────────────────────┤
│  Trust (profile 로드 + checkPermission)           │  ← 에이전트 판단 대체
├──────────────────────────────────────────────────┤
│  Planner            │  Executor         │  Setup │
├──────────────────────────────────────────────────┤
│  Wiring (cross-service)                           │
├──────────────────────────────────────────────────┤
│  Connectors (Cloud Run, Firebase, ...)            │
├──────────────────────────────────────────────────┤
│  Auth (AuthManager → providers)                   │
└──────────────────────────────────────────────────┘
```

의존 방향: 위 → 아래. 역방향 금지. CLI와 MCP 서버는 core 라이브러리를 공유.

---

## 3. 디렉토리 구조

```
src/
├── cli/
│   ├── index.ts              commander 진입, --output 글로벌 옵션
│   ├── output.ts             JSON/Human 출력 (success/fail/info)
│   ├── prompt.ts             human 모드 확인 프롬프트
│   └── commands/
│       ├── init.ts           GCP 세팅 자동화 (신규)
│       ├── link.ts           repo + GCP 스캔 → plan 생성 (신규)
│       ├── deploy.ts         plan 실행 + wiring (재작성)
│       ├── doctor.ts         진단
│       ├── auth.ts           인증 상태/갱신
│       ├── budget.ts         예산 한도 + 알림 (admin surface)
│       ├── secret.ts         Secret Manager (admin surface)
│       ├── iam.ts            권한 조회/부여/회수 (admin surface)
│       ├── notify.ts         알림 채널 (admin surface)
│       ├── security.ts       audit + 최소권한 (admin surface)
│       └── add/              Phase 2+ (firestore, gemini, storage, ...)
│
├── planner/
│   ├── detect.ts             repo 스캔 (Dockerfile, package.json, framework 감지)
│   ├── gcp-state.ts          GCP 현재 상태 조회
│   ├── plan-builder.ts       detected + state → project.yaml 생성
│   └── schema.ts             project.yaml 타입 정의
│
├── executor/
│   └── apply.ts              plan을 받아 순차 실행 (단순, 추상화 없음)
│
├── trust/
│   ├── profile.ts            TrustProfile 로드/저장 (.omg/project.yaml의 trust: 섹션)
│   ├── levels.ts             L0~L3 액션 매핑
│   └── check.ts              checkPermission(action, profile) → auto | confirm | approve
│
├── mcp/
│   ├── server.ts             @modelcontextprotocol/sdk 기반 MCP 서버
│   └── tools.ts              각 omg 커맨드 → MCP tool 매핑
│
├── setup/
│   ├── project.ts            GCP 프로젝트 생성/선택
│   ├── billing.ts            빌링 계정 연결
│   ├── apis.ts               필수 API 활성화
│   └── iam.ts                서비스 계정/역할 기본 세팅
│
├── admin/
│   ├── budget.ts             Cloud Billing Budgets API
│   ├── secrets.ts            @google-cloud/secret-manager
│   ├── iam-ops.ts            gcloud projects add-iam-policy-binding
│   ├── notify.ts             Cloud Monitoring Notification Channels
│   └── security.ts           audit log + IAM 분석
│
├── wiring/
│   ├── firebase-rewrites.ts  Cloud Run URL → firebase.json rewrites 주입
│   ├── env-inject.ts         환경변수 매핑
│   └── secret-link.ts        Secret Manager 값 → 서비스 env
│
├── connectors/
│   ├── cloud-run.ts          Cloud Run (gcloud + @google-cloud/run)
│   ├── firebase.ts           Firebase (firebase CLI)
│   └── ...                   (Phase 2: firestore.ts, storage.ts, ...)
│
├── auth/
│   ├── auth-manager.ts       프로바이더 통합 (GCP + Firebase 단일 진입점)
│   ├── gcp-provider.ts       GCP ADC 기반 (gcloud auth application-default)
│   ├── firebase-provider.ts  Firebase 토큰 기반 (firebase login:ci or ADC share)
│   └── api-key-provider.ts   Gemini 등 API 키 기반 (Phase 2+)
│
└── types/
    ├── errors.ts             OmgError 계층
    ├── connector.ts          Connector 인터페이스 (단순화, AsyncConnector 제거)
    └── plan.ts               ProjectPlan 타입 (pipeline.ts 대체)
```

`skills/`, `adapters/`, `orchestrator/` 는 **없음**. MVP에서 제거.

---

## 4. 핵심 데이터 구조

### 4.1 ProjectPlan (`.omg/project.yaml`)

```ts
export interface ProjectPlan {
  version: 1;
  project: {
    id: string;
    region: string;
  };
  detected: {
    stack: StackType;           // 'static' | 'spa-plus-api' | 'api-only' | 'functions'
    frontend?: FrontendDetection;
    backend?: BackendDetection;
  };
  targets: {
    frontend?: {
      service: 'firebase-hosting';
      siteName: string;
    };
    backend?: {
      service: 'cloud-run';
      serviceName: string;
      region: string;
      port: number;
      memory?: string;
      allowUnauthenticated?: boolean;  // 기본 false (안전)
    };
  };
  wiring: WiringRule[];
  environment: EnvironmentMap;
  deploymentOrder: string[];      // ['backend', 'frontend']
  checks: Check[];
  warnings: string[];
}

export interface FrontendDetection {
  type: 'vite-react' | 'cra' | 'static-html' | 'vue' | 'svelte' | 'next-spa';
  buildCommand: string;
  outputDir: string;
  framework?: string;
}

export interface BackendDetection {
  type: 'python-fastapi' | 'python-flask' | 'node-express' | 'node-fastify' | 'generic-docker';
  dockerfile?: string;
  buildpack?: boolean;
  port: number;
  startCommand?: string;
}

export interface WiringRule {
  from: string;                  // 'frontend.rewrites["/api/**"]'
  to: string;                    // 'backend.cloudRun.url'
}

export type EnvironmentMap = Record<
  'backend' | 'frontend',
  Record<string, string | { secret: string }>
>;

export interface Check {
  id: string;
  description: string;
  severity: 'error' | 'warning';
}
```

### 4.2 Connector 인터페이스 (단순화)

```ts
export interface Connector<Req = unknown, Res = unknown> {
  readonly id: ConnectorId;
  readonly displayName: string;
  healthCheck(config: ConnectorConfig): Promise<HealthStatus>;
  execute(action: string, params: Req, config: ConnectorConfig): Promise<ConnectorResult<Res>>;
}
```

`AsyncConnector` 제거. Jules 복귀 시점에 필요하면 그때 추가.

### 4.3 OmgConfig (`~/.omg/config.json`)

```ts
export interface OmgConfig {
  profile: {
    projectId: string;
    region?: string;
    accountEmail?: string;
  };
  apiKeys?: {
    gemini?: string;
    jules?: string;
  };
}
```

---

## 5. 실행 흐름

### 5.1 `omg init`

```
1. gcloud CLI 존재 확인
2. 로그인/ADC 상태 확인 → 필요 시 인증 플로우 트리거
3. [human] 프로젝트 선택 (기존 or 신규)
   [json]  --project 플래그 필수
4. 빌링 계정 확인/연결
5. 기본 API enable (serviceusage batch)
   cloudbuild, run, artifactregistry, firebasehosting, firestore,
   secretmanager, logging
6. 기본 IAM 세팅
7. ~/.omg/config.json 저장
8. JSON 결과 반환
```

### 5.2 `omg link`

```
1. omg 설정 로드 (없으면 init 유도)
2. repo 스캔 (detect.ts)
   - Dockerfile, package.json, requirements.txt, firebase.json, etc.
   - stack 결정: static / spa-plus-api / api-only / functions
3. GCP 상태 조회 (gcp-state.ts)
   - 활성 API, 기존 서비스, 기존 Firebase 사이트
4. plan-builder 실행
   - Detection + State → ProjectPlan 생성
   - wiring 규칙 추가 (API URL → rewrites)
   - 환경변수 추론
   - checks 목록 작성
   - warnings (Next.js SSR 감지 등)
5. .omg/project.yaml 저장 (git commit 가능)
6. JSON 출력
```

### 5.3 `omg deploy`

```
1. .omg/project.yaml 로드 (없으면 link 유도)
2. checks 실행 → 실패 시 중단
3. --dry-run 이면 계획 JSON 출력하고 종료
4. 확인 게이트 (JSON 모드는 --yes 필수)
5. deploymentOrder 순서대로:
   a. 단계 pre-validate
   b. connector.execute(...)
   c. 결과 context에 저장 (다음 단계에서 사용)
   d. wiring 규칙 적용 (예: Cloud Run URL → firebase.json rewrites)
   e. post-validate (health check)
6. 실패 시 역순 롤백 시도
7. 결과 JSON (모든 URL, 상태, duration)
```

---

## 6. 하네스 철학

### 6.1 소프트 자동화 (기본값)
- 프로젝트 생성, API enable, IAM 기본 세팅
- 서비스 감지, 스택 결정
- wiring 규칙 자동 생성
- 환경변수 매핑

### 6.2 하드 통제 (확인 필요)
- **프로덕션 배포** — 확인 게이트
- **Firestore rules 변경** — diff 표시
- **BigQuery 대용량 쿼리** — 비용 경고 (Phase 3+)
- **Secret Manager 쓰기** — 확인
- **삭제/롤백** — 확인

### 6.3 JSON 모드 정책
- 확인 프롬프트 자동 스킵되지 **않음** — `--yes` 없으면 `PENDING_CONFIRMATION` 에러 반환
- 에이전트는 `--dry-run`으로 계획 확인 후 `--yes`로 실행

---

## 7. 에러 모델

```ts
class OmgError extends Error {
  code: string;             // "AUTH_ERROR" | "NO_BILLING" | ...
  recoverable: boolean;
  hint?: string;
}
```

주요 에러 코드:

| code | 의미 | recoverable | 에이전트 대응 |
|---|---|---|---|
| `AUTH_ERROR` | 인증 실패/만료 | false | `omg setup` 또는 `omg auth refresh` |
| `NO_BILLING` | 빌링 없음 | false | `--billing` 플래그로 재시도 |
| `API_ENABLE_FAILED` | API 활성화 실패 | true | 권한 확인 후 재시도 |
| `NO_DEPLOYABLE_CONTENT` | 배포할 것 없음 | false | repo 확인 |
| `PLAN_REQUIRED` | project.yaml 없음 | false | `omg link` 실행 |
| `PENDING_CONFIRMATION` | 확인 필요 | false | `--yes` 추가 |
| `CHECK_FAILED` | 사전 체크 실패 | true | 메시지 확인 후 수정 |
| `DEPLOY_FAILED` | 배포 실행 실패 | true | `omg logs` + 재시도 |
| `QUOTA_EXCEEDED` | 쿼터 초과 | true | 대기 후 재시도 |
| `WIRING_FAILED` | 서비스 연결 실패 | true | 상세 로그 확인 |

---

## 8. 확장 지점 (Phase 2+)

### 8.1 `omg add <resource>`

```
omg add firestore      Firestore 초기화 + rules 기본값
omg add storage        Cloud Storage 버킷
omg add secret KEY=... Secret Manager 등록
omg add gemini         Vertex AI Gemini + env 주입
omg add sql            Cloud SQL 인스턴스
omg add analytics      Google Analytics 측정 ID
```

각 명령은 `ProjectPlan`을 업데이트하고 커넥터를 호출.

### 8.2 새 스택 추가

`planner/detect.ts`에 감지 로직 추가 + `plan-builder.ts`에 타겟 매핑 추가.
커넥터 자체는 변경 없음.

### 8.3 새 연결 추가

`wiring/`에 파일 추가. Plan의 `wiring` 배열에 규칙 명시.

---

## 9. 명시적 비범위

- Pipeline orchestrator (Phase 6에서 재고)
- Adapter 레이어 (필요성 재검증 후)
- SKILL 로더 (문서로 대체)
- Jules / Stitch (opt-in, alpha/실험 API)
- Next.js SSR 배포 (Vercel 권장, 필요 시 Cloud Run + 직접 설정)

---

## 10. 현재 상태 → 목표 상태

### 지금 (커밋됨)
```
✓ CLI 뼈대, --output json
✓ AuthManager + GcpAuthProvider
✓ Cloud Run / Firebase connector
✓ OmgError 계층
✓ omg deploy / omg firebase (Phase 1에서 deprecate 후 재설계)
✗ init / link 없음
✗ planner / executor / wiring / setup 없음
```

### 목표 (Phase 1 끝)
```
+ omg init (GCP 자동 세팅)
+ omg link (plan 생성)
+ omg deploy 재작성 (plan 실행)
+ planner/, executor/, wiring/, setup/
+ .omg/project.yaml 스키마
+ 핵심 단위 테스트
- pipeline.ts, AsyncConnector 제거
```

---

*v1.0.0 — Planner 중심, Pipeline/Adapter 제거. Vercel-killer 포지셔닝에 맞춘 최소 아키텍처.*
