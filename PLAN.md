# oh-my-google — Implementation Plan (v3)

> PRD v1.0.0과 정렬. "바이브코더용 Vercel-killer for Google" 포지셔닝.
> MVP 핵심: `omg init → omg link → omg deploy` 3개 명령어.

---

## 원칙

1. **GCP + Firebase 통합**: 두 CLI/auth/console을 한 진입점으로. 이게 omg 존재 이유.
2. **MVP = 4개 커맨드**: `init / link / deploy / doctor`. admin surface는 Phase 2 이후.
3. **Setup-time intense + Runtime hands-off**. init 1회 승인으로 Trust Profile → 이후 자동.
4. **에이전트 자체 판단 금지**. Trust Profile이 결정.
5. **배포 채널 2개**: npm + MCP. Claude Code/Codex plugin은 Phase 2.
6. **Cross-service wiring** (Cloud Run URL → Firebase rewrites)은 MVP 핵심.
7. **GA 서비스만**. Jules/Stitch는 후순위.
8. **추상화 금지** until 동일 패턴 3번 반복.

---

## 정리: 현재 가진 것

```
✓ CLI 뼈대 (commander + --output json)
✓ Auth 기초 (GCP ADC)
✓ doctor 진단
✓ Cloud Run 커넥터 (gcloud wrapper)
✓ Firebase 커넥터 (firebase CLI wrapper)
✓ 에러 계층 (OmgError → AuthError, ApiError, ...)
✓ 구조화 JSON 출력 (ok/command/data/error/next)
```

## 정리: 버릴 것 (PRD 재설계로 제거)

```
✗ PipelineExecutor / StepSelector / ExecutionRepository 타입 (미사용)
✗ AsyncConnector 인터페이스 (Jules 빠져서 불필요)
✗ Adapter 레이어 (CLI로 충분)
✗ 구 deploy 커맨드 (init/link/deploy 패턴으로 교체)
```

---

## Phase 1 — MVP: init / link / deploy (2-3 세션)

### 1.1 `omg init` — 무지성 세팅

목표: 빈 디렉토리에서 한 번 실행하면 GCP가 바로 쓸 수 있는 상태.

#### 동작 흐름
```
1. gcloud CLI 설치 확인 → 없으면 안내 후 종료
2. 로그인 상태 확인
   - 없으면 gcloud auth login 유도
   - ADC 없으면 gcloud auth application-default login
3. 프로젝트 선택/생성
   - 기존 프로젝트 목록 제시
   - 또는 새 프로젝트 생성 (이름 입력 + billing account 선택/연결)
4. 필요 API 활성화 (기본 세트)
   - cloudbuild, run, artifactregistry, firebasehosting, firestore, secretmanager
5. IAM 기본 세팅
   - 서비스 계정 생성 또는 기본 서비스 계정 사용
   - 필요 role 부여
6. ~/.omg/config.json 저장
```

#### 작업
- [ ] `src/cli/commands/init.ts` 새로 작성
- [ ] `src/setup/project.ts` — GCP 프로젝트 생성/선택 (listProjects, createProject)
- [ ] `src/setup/billing.ts` — 빌링 계정 연결 (listBillingAccounts, enableBilling)
- [ ] `src/setup/apis.ts` — API 활성화 배치 (serviceusage)
- [ ] `src/setup/iam.ts` — 기본 IAM 세팅
- [ ] 대화형 프롬프트 (@inquirer/prompts) — human 모드에서만
- [ ] JSON 모드에서는 `--project`, `--billing`, `--yes` 플래그 강제

#### 수용 기준
- `omg init --project my-proj --billing XXXX --yes` 논인터랙티브 실행
- JSON 모드: `{ok: true, command: "init", data: {projectId, enabledApis, iamRoles}}`
- 실패 시 에러 코드 (`NO_BILLING`, `API_ENABLE_FAILED` 등) + hint

---

### 1.2 `omg link` — repo 감지 + 배포 계획

목표: 현재 repo를 분석하고 GCP 상태와 대조해서 **배포 계획 JSON** 생성.

#### 감지해야 할 것
```
repo 쪽:
- Dockerfile 있음? → Cloud Run 후보
- package.json 있음? (engines, scripts.build, scripts.start)
- requirements.txt / pyproject.toml → Python
- firebase.json → Firebase 설정 존재
- next.config.js → Next.js (MVP에서 경고: Vercel 권장)
- public/ + index.html → 정적
- functions/ → Firebase Functions
- .env.production → 환경변수

GCP 쪽:
- 현재 프로젝트, 리전
- 활성화된 API
- 이미 배포된 Cloud Run 서비스
- Firebase 프로젝트 연결 여부
```

#### 계획 산출물 (`.omg/project.yaml`)
```yaml
detected:
  stack: spa-plus-api           # static | spa-plus-api | api-only | functions | ...
  frontend:
    type: vite-react
    buildCommand: npm run build
    outputDir: dist
  backend:
    type: python-fastapi
    dockerfile: ./api/Dockerfile
    port: 8080

targets:
  frontend:
    service: firebase-hosting
    siteName: my-project
  backend:
    service: cloud-run
    serviceName: my-api
    region: asia-northeast3

wiring:
  - from: frontend.rewrites["/api/**"]
    to: backend.cloudRun.url

environment:
  backend:
    DATABASE_URL: "${SECRET:DATABASE_URL}"
    GEMINI_API_KEY: "${SECRET:GEMINI_API_KEY}"

deploymentOrder:
  - backend
  - frontend

checks:
  - "All required APIs enabled"
  - "Dockerfile valid"
  - "Build succeeds locally"
```

#### 작업
- [ ] `src/cli/commands/link.ts`
- [ ] `src/planner/detect.ts` — repo 스캔
- [ ] `src/planner/gcp-state.ts` — GCP 상태 조회
- [ ] `src/planner/plan-builder.ts` — 조합해서 계획 생성
- [ ] `src/planner/schema.ts` — .omg/project.yaml 스키마
- [ ] yaml 라이브러리 (`yaml` npm)
- [ ] 경고/권장사항: Next.js SSR 감지 시 경고

#### 수용 기준
- 빈 repo에서 실행 → `NO_DEPLOYABLE_CONTENT` 에러
- 정적 HTML만 있는 repo → Firebase Hosting 계획
- Dockerfile만 있는 repo → Cloud Run 계획
- 혼합 repo → 둘 다 + wiring 계획
- `--output json` 결과에 전체 plan 포함
- `.omg/project.yaml` 파일로 저장됨 (git commit 가능)

---

### 1.3 `omg deploy` — 계획 실행 + wiring

목표: `.omg/project.yaml` 대로 실행. 크로스 서비스 연결 자동.

#### 동작 흐름
```
1. project.yaml 로드 (없으면 omg link 먼저 안내)
2. 사전 체크 (checks 목록 실행)
3. --dry-run 이면 실행 계획 JSON만 출력하고 종료
4. 확인 게이트 (JSON 모드는 --yes 필수)
5. deploymentOrder대로 순차 실행:
   a. backend 배포 → URL 획득 → context에 저장
   b. frontend 배포 (이전 단계 URL을 rewrites에 주입)
6. 각 단계 후 검증 (health check)
7. 실패 시 롤백 가능한 단계는 롤백
8. 결과 JSON 반환 (모든 URL, 상태, duration, cost estimate)
```

#### 작업
- [ ] `src/cli/commands/deploy.ts` (완전 교체)
- [ ] `src/executor/apply.ts` — plan을 받아 순차 실행 (간단한 순차 러너, 추상화 없음)
- [ ] `src/wiring/firebase-rewrites.ts` — firebase.json 수정
- [ ] `src/wiring/secret-env.ts` — Secret Manager → env 매핑
- [ ] 기존 `cloudRunConnector`, `firebaseConnector` 그대로 활용
- [ ] 결과에 `url`, `revision`, `hostingUrl` 등 포함

#### 수용 기준
- 풀스택 repo에서 단일 명령으로 API + 프론트 배포 완료
- API URL이 `firebase.json` rewrites에 자동 반영됨
- JSON 결과에 두 URL 모두 포함
- 실패 시 구조화 에러 + 롤백 시도

---

### 1.4 Trust Profile + MCP 서버

#### Trust Profile 저장 스키마
- [ ] `src/trust/profile.ts` — TrustProfile 타입 + 로드/저장
- [ ] `.omg/project.yaml`의 `trust:` 섹션 파싱
- [ ] 기본 레벨 매핑: L0/L1/L2/L3 → 각 커맨드/액션에 태깅
- [ ] `checkPermission(action, profile)` — 실행 전 gate

#### init에서 Trust Profile 생성
- [ ] `omg init`이 대화형으로 environment/budgetCap/allowedServices 수집
- [ ] JSON 모드에서는 `--trust-profile <yaml>` 플래그로 주입
- [ ] 기본값 제공 (가장 보수적): 모든 환경 require_confirm, prod require_approval

#### MCP 서버
- [ ] `src/mcp/server.ts` — `@modelcontextprotocol/sdk` 기반
- [ ] `omg mcp-serve` 커맨드 추가 (stdio/sse 모드)
- [ ] 각 CLI 커맨드 = MCP tool (같은 JSON I/O)
- [ ] Trust Profile을 MCP context로 노출

### 1.5 보조 작업

- [ ] `omg doctor` 업데이트 — init + admin surface 상태 체크
- [ ] 기존 `omg deploy`와 `omg firebase deploy` → 내부 helper로 강등 (사용자 노출 X)
- [ ] 제거: 미사용 타입 (`src/types/pipeline.ts`, `AsyncConnector`)
- [ ] `vitest` 세팅 + 핵심 단위 테스트:
  - `detect.ts` (stack 감지 로직)
  - `plan-builder.ts` (계획 생성)
  - `wiring/firebase-rewrites.ts` (rewrites 주입)
  - `iam.ts` Propose/Execute 분리

---

## Phase 2 — 데이터 + 스토리지 (2 세션)

MVP 이후. Gemini/BigQuery 붙이기 전 데이터 계층.

- [ ] `omg add firestore` — Firestore 초기화 + rules 템플릿
- [ ] `omg add secret <key>` — Secret Manager 값 등록 → env 자동 매핑
- [ ] `omg add storage <bucket>` — Cloud Storage 버킷 생성
- [ ] `omg add sql <instance>` — Cloud SQL + 연결 설정
- [ ] link가 이 리소스들을 감지/연결

---

## Phase 3 — AI (1-2 세션)

- [ ] `omg add gemini` — Vertex AI API 활성화 + API 키 발급 + env 주입
- [ ] `src/connectors/gemini.ts` — 간단 호출 헬퍼
- [ ] `omg gemini prompt <text>` — 간단 테스트용
- [ ] 템플릿: "Gemini 사용 React 앱"

---

## Phase 4 — 디자인 인입 (옵셔널, Stitch 안정화 후)

- [ ] Stitch MCP 서버 연결 (가능 시)
- [ ] DESIGN.md 기반 워크플로우
- [ ] 디자인 → 코드 스캐폴딩 헬퍼

---

## Phase 5 — 마케팅 / 분석 (2 세션)

- [ ] `omg add analytics` — Google Analytics 측정 ID 연결
- [ ] `omg ads setup` — Google Ads API 기초 (캠페인 생성은 범위 초과, 계정 연결만)
- [ ] `omg add logging` — Cloud Logging 기본 대시보드

---

## Phase 6 — 전체 라이프사이클 (장기)

이때 Pipeline 추상화가 의미 있어짐 (3+ 워크플로우 반복 패턴 확보 후).

- [ ] 파이프라인 정의 (design → code → deploy → analytics)
- [ ] `omg flow <flowname>` — 정의된 플로우 실행
- [ ] 상태 영속 (`~/.omg/state/flows/`)
- [ ] Resume/cancel

---

## Phase 7 — 배포

- [ ] GitHub Actions CI (typecheck + test + build)
- [ ] README 실제 사용 GIF
- [ ] `npx oh-my-google` 검증
- [ ] `npm publish`

---

## 즉시 실행할 것 (다음 세션 Phase 1.1 시작)

1. [ ] 미사용 타입 제거 (`AsyncConnector`, `pipeline.ts`)
2. [ ] `@inquirer/prompts` 의존성 추가
3. [ ] `yaml` 의존성 추가
4. [ ] `src/setup/` 디렉토리 구조 생성
5. [ ] `omg init` 최소 구현 시작

---

## 핵심 변화 요약 (v2 → v3)

| 항목 | v2 | v3 |
|---|---|---|
| 핵심 명령어 | `deploy`, `pipeline` | **`init`, `link`, `deploy`** |
| 포지셔닝 | "에이전트 퍼스트 하네스" | **"Vercel-killer for Google (바이브코더용)"** |
| MVP 경로 | 커넥터 정비 → Firebase 확장 → Pipeline | **init → link → deploy (fullstack wiring)** |
| 제거 | - | Pipeline, Adapter, AsyncConnector |
| 추가 | - | GCP 프로젝트/빌링/IAM 자동화, repo detection, cross-service wiring |
