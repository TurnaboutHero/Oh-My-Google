# oh-my-google (omg) — Product Requirements Document

> 버전: 2.0.0 (에이전트 타겟 확정 + admin surface 확장)
> 최종 수정: 2026-04-15

---

## 1. 한 줄 요약

**AI 에이전트가 Google Cloud (GCP) + Firebase를 하나의 프로젝트로 통합해서, 사용자가 초기에 설정한 trust 규칙 안에서 안전하고 자동으로 다루는 하네스.**

핵심 가치: **두 세계 통합**
- Firebase 프로젝트 = GCP 프로젝트 (1:1) 이지만 현실은 **별도 CLI, 별도 auth, 별도 console** → 에이전트가 자주 깨짐
- omg = 두 CLI(`gcloud` + `firebase`)를 통합 진입점으로 묶음
- **Cross-service wiring** (Cloud Run URL → Firebase rewrites) 자동화 = 킬러 기능

핵심 패턴: **Setup-time intense + Runtime hands-off**
- 초기 1회: 범위/위험 수준/환경 설정 → 사용자 명시적 승인 (Trust Profile 생성)
- 이후 실행: profile 규칙에 따라 L0/L1/L2는 자동, L3만 추가 승인
- **에이전트는 자체 판단 금지** — profile이 결정함

---

## 2. 문제 정의

### 2.1 현실

바이브코딩 사용자(v0, Cursor, Claude Code 등)의 전형적 스택:
```
v0로 디자인 → 프론트 생성 → Vercel 배포 → Supabase 연결
```

이게 편한 이유: **권한/세팅이 단순하고 "연결"만 하면 됨.**

### 2.2 왜 진짜 개발자는 AWS/Cloudflare/Google을 쓰는가

- Vercel 서버리스 함수는 시간 제한 (긴 작업 불가)
- Supabase는 Firebase보다 생태계 약함 (Gemini, BigQuery 등 Google 전용 서비스 없음)
- 무료 티어가 Google이 훨씬 관대함
- 엔터프라이즈 보안/컴플라이언스는 Google/AWS가 표준

### 2.3 그런데 왜 바이브코더는 Google 안 쓰는가

**시작도 못 하고 포기함. 특히 GCP + Firebase 경계에서 혼란.**

에이전트가 GCP + Firebase 건드릴 때 막히는 지점:
1. **두 세계 경계** — "Firebase 프로젝트와 GCP 프로젝트가 같은 건지 다른 건지" 에이전트도 헷갈림
2. **두 CLI, 두 auth** — `gcloud auth` vs `firebase login` 별개. ADC vs Firebase 토큰 별개
3. **프로젝트 생성** — GCP 프로젝트 ID 충돌, 빌링 계정 연결 혼란
4. **API enabling** — Firebase 콘솔에서 켜야 하는 것 vs GCP에서 켜야 하는 것 혼재
5. **IAM 권한** — GCP IAM + Firebase 역할 두 시스템
6. **Firebase init 같은 interactive 프롬프트** — 에이전트가 TTY 처리 못함
7. **Cross-service wiring** — Cloud Run URL → Firebase rewrites 수동 연결
8. **비용 불안** — BigQuery 쿼리 하나가 $100 나올 수도

이 중 1, 2, 4, 5, 7이 **두 세계가 따로 놀아서 생기는 문제**. omg가 통합 진입점이 되면 해소.

---

## 3. 해결 방법

### 3.1 핵심 가치 제안

> **"omg init → omg link → omg deploy 세 명령어로 GCP + Firebase 통합 배포 완료."**

경쟁 제품 대비 차별점:
- **Vercel**: 프론트 배포만. 컨테이너 백엔드 불가, Firestore/Gemini 등 Google 네이티브 서비스 연결 불가
- **Firebase CLI 단독**: Firebase 서비스만. Cloud Run, BigQuery, Vertex AI 별개
- **gcloud 단독**: GCP 서비스만. Firebase Hosting/Functions 별개
- **omg**: **두 세계를 하나로** — 프론트(Firebase Hosting) + API(Cloud Run) + DB(Firestore/BigQuery) + AI(Gemini) 모두 같은 프로젝트 안에서 자동 연결

### 3.2 하네스 철학

에이전트가 **이상한 길로 못 빠지게** 제어:
- 자동화할 수 있는 건 자동화 (무지성 쉬움)
- 비용/보안 영향 있는 건 명시적 확인 (하드 통제)
- 에이전트가 추측하면 위험한 건 code가 결정 (예: 서비스 선택, 권한)

| 자동화 (소프트) | 확인/통제 (하드) |
|---|---|
| 프로젝트 생성, API enable | 프로덕션 배포 |
| IAM 기본 세팅 | Firestore rules 변경 |
| 서비스 감지, wiring | BigQuery 대용량 쿼리 |
| 환경변수 매핑 | Secret Manager 쓰기 |
| rewrites 자동 생성 | 비용 발생 작업 |

---

## 4. 포지셔닝

### 4.1 대 Vercel + Supabase

| | Vercel + Supabase | oh-my-google |
|---|---|---|
| 시작 난이도 | 쉬움 | **omg로 같은 수준** |
| 프론트 배포 | 자동 | 자동 |
| DB | Supabase Postgres | Firestore, Cloud SQL, BigQuery 선택 |
| AI | 외부 API | **Gemini 네이티브 (무료 티어 관대)** |
| 장시간 서비스 | ❌ (타임아웃) | ✅ Cloud Run |
| 무료 티어 | 좁음 | 관대함 |
| 엔터프라이즈 | 제한적 | Google 표준 |
| 생태계 | 2개 회사 | **Google 전체** |

### 4.2 대 gcloud/firebase CLI

| | gcloud/firebase | omg |
|---|---|---|
| 출력 | 사람용 텍스트 | **에이전트용 JSON** |
| 기본값 | 전문가 대상 | **안전 기본값** |
| 세팅 | 수동 10단계 | **자동 1단계** |
| 에러 | 텍스트 파싱 | **구조화 에러 코드** |
| 확인 | 대부분 없음 | **하드 하네스** |
| 서비스 연결 | 수동 | **자동 wiring** |

### 4.3 아이덴티티

- gcloud/firebase: **사람용**
- omg: **에이전트 + 바이브코더용**

서비스는 교체 가능한 부품. 하네스가 본체.

---

## 5. 타겟 사용자

### 5.1 Primary: AI 코딩 에이전트

Claude Code, Codex, Antigravity, OpenCode, Gemini CLI, Cursor 등.
- omg는 에이전트가 GCP를 건드릴 때 호출하는 **툴**
- 사람이 `omg` 직접 치는 시나리오는 소수
- 에이전트가 plugin/MCP/bash를 통해 호출

### 5.2 Indirect: 에이전트 사용자 (바이브코더 포함)

"Claude Code에서 Gemini 써서 앱 만들어줘" 같은 시나리오.
- 사람은 omg 존재를 모를 수도 있음
- 에이전트가 내부적으로 omg 호출 → 안전하게 완수
- 결과만 사람에게 보여짐 (승인 프롬프트 포함)

### 5.3 Direct (소수): 개발자가 CLI로 직접

gcloud/firebase CLI 대체 용도로 직접 쓰는 개발자.
- 중급 이상, 스크립트/CI 자동화
- JSON 출력 + 안전 기본값이 gcloud보다 낫다고 느끼는 경우

---

## 6. 제품 비전 (장기)

### 6.1 전체 제품 라이프사이클을 Google 안에서

```
┌──────────────────────────────────────────────────┐
│              omg (통합 하네스)                     │
├──────────────────────────────────────────────────┤
│ 디자인 │ 코딩 │ 데이터 │ AI │ 배포 │ 마케팅 │ 분석 │
├────────┼──────┼────────┼────┼──────┼────────┼──────┤
│ Stitch │ agent│Firestore│Gemini│Cloud │Google │ BigQ │
│        │      │ BigQuery│Vertex│ Run  │  Ads  │Looker│
│        │      │Cloud SQL│      │Firebase│Pomelli│      │
└────────┴──────┴────────┴────┴──────┴────────┴──────┘
```

Phase별로 서비스 추가. MVP는 "디자인은 외부 + 코딩은 에이전트 + 배포 집중".

### 6.2 궁극 시나리오

> 사용자: "여행 일정 공유 앱 만들어줘"
>
> 에이전트:
> 1. `omg init travel-app` — GCP 프로젝트 + 인증 + API
> 2. (디자인은 Stitch 또는 수동)
> 3. 코드 생성 (React + FastAPI)
> 4. `omg link` — 자동 감지: SPA + API → Firebase + Cloud Run + Firestore
> 5. `omg add gemini` — 여행 추천 AI 기능
> 6. `omg deploy` — 배포 완료
> 7. `omg marketing setup` — Google Analytics 연결 (장기)
>
> 결과: 작동하는 앱 URL + 관리 대시보드 링크.

---

## 7. MVP 범위 (초기 목표)

### 7.1 핵심 커맨드 (3개)

```
omg init     1회 세팅: GCP 프로젝트 + 인증 + 빌링 + API + Trust Profile 생성
             → .omg/project.yaml 저장 (git 커밋 가능)
omg link     repo + GCP 상태 스캔 → 배포 계획 JSON (profile 기반 wiring)
omg deploy   계획대로 배포 + 서비스 간 자동 wiring (profile 규칙 따름)
omg doctor   read-only 전체 진단 (신뢰 형성 진입점)
```

**admin surface (budget/secret/iam/notify/security) = Phase 2 이후.**
이유: MVP에서 표면적 커버리지보다 깊이 있는 배포 워크플로우 증명이 우선.

### 7.2 Trust Model

**초기 1회 설정 (명시적 승인 필수):**
```yaml
# .omg/project.yaml
trust:
  environments:
    dev:   auto_deploy       # dev 배포는 자동
    stage: require_confirm   # stage는 확인
    prod:  require_approval  # prod는 매번 승인
  budgetCap: 50              # USD/월, 초과 시 차단
  allowedServices:
    - cloud-run
    - firebase-hosting
  forbiddenActions:
    - iam.serviceAccount.create  # 금지
    - project.delete
```

**실행 시 (profile 따름):**

| 레벨 | 작업 | profile 허용 시 |
|---|---|---|
| L0 | read-only (doctor, status, list) | **자동** |
| L1 | metadata read (describe, logs) | **자동** |
| L2 | dev/staging 배포, secret 읽기 | profile 따름 (자동 or 확인) |
| L3 | prod 배포, IAM 변경, 리소스 삭제 | **매번 승인 필수** |

**에이전트 행동 원칙:**
- 에이전트는 "이건 위험도 낮을 것 같아" 같은 판단 금지
- profile이 자동/승인 결정. 에이전트는 따르기만
- profile에 없는 작업 = 기본 거부 (L3 처리)

### 7.3 배포 채널 (축소)

**MVP**: **npm 패키지** + **MCP 서버** 둘만.
- npm: `omg` CLI (Bash 기반 에이전트용: Antigravity, Gemini CLI, 스크립트)
- MCP: Claude Code, Cursor, Windsurf 등 네이티브 tool call

Phase 2 이후: Claude Code plugin, Codex plugin (얇은 wrapper)

### 7.4 MVP에서 **하지 않는** 것

- admin surface 커맨드 (budget/secret/iam/notify/security) — Phase 2
- Next.js SSR 지원 (Vercel 권장)
- Jules 통합 (alpha)
- Stitch 통합 (실험)
- Gemini/BigQuery/Cloud SQL (Phase 3)
- 마케팅 (Phase 5)
- Pipeline orchestrator / Adapter / SKILL 로더

### 7.3 지원 스택 (배포 대상)

| 스택 | 목적지 |
|---|---|
| 정적 (HTML/Vite SPA) | Firebase Hosting |
| Python API (+ Dockerfile) | Cloud Run |
| Node API (+ Dockerfile) | Cloud Run |
| **Fullstack (SPA + API monorepo)** | **Firebase + Cloud Run + rewrites 자동 연결** |

### 7.4 배포 채널

| 채널 | 설명 | 우선순위 |
|---|---|---|
| npm package (`oh-my-google`) | `npx omg ...` 호출 | 1차 |
| Claude Code plugin | Marketplace 등록 + /omg 스킬 | 1차 |
| Codex plugin | Codex plugin 형태 | 2차 |
| MCP 서버 | 에이전트 네이티브 tool call | 2차 |
| Antigravity workflow | 워크플로우 YAML 번들 | 3차 |

### 7.5 MVP에서 **하지 않는** 것

- Next.js SSR 지원 (Vercel이 압도적, 나중에 추가)
- Jules 통합 (alpha)
- Stitch 통합 (API 불확실)
- Gemini/BigQuery/Cloud SQL (Phase 3)
- 마케팅 (Phase 5)
- Pipeline orchestrator 추상화 (과잉)
- SKILL 로더 (문서로 대체)

### 7.4 MVP 수용 기준

1. 빈 디렉토리에서 `omg init` → GCP 프로젝트 + 인증 + 필요 API 활성화 완료
2. FastAPI + React 혼합 repo에서 `omg link` → 배포 계획 JSON 생성
3. `omg deploy` → Cloud Run API 배포 → URL을 Firebase rewrites에 자동 주입 → Hosting 배포
4. `omg --output json deploy` 결과에 배포 URL 포함
5. 에뮬레이터/테스트 통과 없이는 deploy 안 됨 (안전 기본값)
6. 실수로 프로덕션 덮어쓰기 방지 (확인 게이트)

---

## 8. 로드맵

### Phase 1 — MVP: 세팅 + 배포 (현재)
- `omg init` / `omg link` / `omg deploy`
- Cloud Run + Firebase Hosting
- 크로스 서비스 wiring

### Phase 2 — 데이터 + 스토리지
- Firestore (DB 연결, 규칙 배포)
- Cloud Storage (파일)
- Cloud SQL (관계형 DB)
- Secret Manager 통합

### Phase 3 — AI
- Gemini (Vertex AI 경유) — 네이티브 AI 기능
- Embeddings / RAG 헬퍼

### Phase 4 — 디자인 인입
- Stitch (API 안정화 시) → 디자인 파일 → 코드 스캐폴딩
- DESIGN.md 기반 워크플로우

### Phase 5 — 마케팅 / 분석
- Google Analytics 연결
- Google Ads (API 있음)
- Pomelli (한국 지원 시)
- Looker Studio 대시보드 링크

### Phase 6 — 전체 라이프사이클 오케스트레이션
- "아이디어 → 배포된 앱" end-to-end
- 실제 오케스트레이터가 여기서 필요 (MVP에는 과잉, Phase 6에 적합)

---

## 9. 비지원 / 명시적 제외

- 특정 코딩 에이전트 플러그인 (omc/omo가 담당)
- Next.js SSR MVP 지원 (Vercel 권장)
- Jules alpha API (안정화 후 재고)
- Google Workspace 통합 (범위 초과)
- 멀티 클라우드 (Google 전용)

---

## 10. 성공 지표

- 바이브코더가 GCP 콘솔 안 열고 앱 배포 성공률
- 첫 배포까지 걸리는 시간 (< 5분 목표)
- 에이전트가 omg 명령만으로 해결 가능한 시나리오 수
- 에러 발생 시 error.code 매칭으로 에이전트 자동 복구 성공률

---

*v1.0.0 — Vercel-killer 포지셔닝 확정. MVP는 init+link+deploy.*
