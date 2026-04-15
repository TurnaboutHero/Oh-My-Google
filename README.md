# oh-my-google (omg)

> AI 에이전트가 **Google Cloud (GCP) + Firebase**를 하나의 프로젝트로 통합해서 다루는 하네스.

## 핵심 가치: 두 세계를 하나로

Firebase 프로젝트 = GCP 프로젝트 (1:1)인데 현실은 **별도 CLI, 별도 auth, 별도 console**. 에이전트는 이 경계에서 자주 깨짐.

```
Before:  gcloud auth + firebase login (따로)
         gcloud run deploy + firebase deploy (따로)
         Cloud Run URL 복사 → firebase.json 수정 (수동)

After:   omg init  (한 번)
         omg deploy  (자동 wiring)
```

**핵심 패턴: Setup-time intense + Runtime hands-off**
- 초기 1회: Trust Profile 설정 (사용자 명시 승인)
- 이후: profile 따라 자동. 에이전트 자체 판단 금지.

## 왜?

AI 에이전트(Claude Code, Codex, Antigravity 등)가 Google Cloud 건드릴 때 막히는 지점들:

1. **GCP 인증 혼란** — ADC vs service account vs user auth
2. **Non-interactive 실패** — `firebase init` 같은 TTY 프롬프트
3. **서비스 wiring** — Cloud Run URL → Firebase rewrites 수동 연결
4. **위험한 기본값** — 기본 public exposure 등
5. **출력 파싱 불안정** — gcloud 커맨드마다 다른 포맷
6. **권한/빌링 설정 지옥** — 처음 들어오는 사람이 가장 많이 포기

omg가 해결: **통일된 JSON, 안전 기본값, 자동 wiring, admin surface 통합.**

## 설치

```bash
# npm
npm install -g oh-my-google

# Claude Code plugin
claude plugin install oh-my-google

# Codex plugin
codex plugin install oh-my-google
```

## 3-Step Deploy

```bash
omg init       # GCP 프로젝트 + 인증 + 빌링 + API + IAM 자동
omg link       # repo 분석 → 배포 계획 (.omg/project.yaml)
omg deploy     # 계획대로 배포 + 서비스 간 자동 wiring
```

## Admin Surface (MVP 포함)

```bash
omg budget    예산 한도 + 경고
omg secret    Secret Manager 키 관리
omg iam       권한 조회/부여/회수
omg notify    알림 채널 (Slack/email)
omg security  IAM 최소권한 + audit log
omg doctor    전체 진단
```

모든 변경 작업은 **Propose → Approve → Execute** 패턴 준수.

## 지원 스택 (배포 대상)

| 감지 | 배포 대상 |
|---|---|
| 정적 (HTML, Vite SPA) | Firebase Hosting |
| Python API (+ Dockerfile) | Cloud Run |
| Node API (+ Dockerfile) | Cloud Run |
| **Fullstack (SPA + API)** | **Firebase + Cloud Run + rewrites 자동 연결** |

## 에이전트 사용 (Agent-first)

```bash
omg --output json link
```

```json
{
  "ok": true,
  "command": "link",
  "data": {
    "detected": { "stack": "spa-plus-api" },
    "targets": {
      "frontend": { "service": "firebase-hosting" },
      "backend": { "service": "cloud-run", "region": "asia-northeast3" }
    },
    "wiring": [{ "from": "frontend.rewrites[/api/**]", "to": "backend.cloudRun.url" }]
  },
  "next": ["omg deploy --dry-run"]
}
```

구조화 에러:

```json
{
  "ok": false,
  "command": "init",
  "error": {
    "code": "NO_BILLING",
    "message": "No billing account linked.",
    "recoverable": false,
    "hint": "Add --billing <ID> flag."
  }
}
```

자세한 에이전트 통합: [AGENTS.md](./AGENTS.md)

## 안전 기본값 (Hard Harness)

- **Dry-run 우선** — `--dry-run` 후 `--yes`로 실행
- **확인 게이트** — 비용/프로덕션 영향 작업은 JSON 모드도 `--yes` 필수
- **안전 기본값** — Cloud Run 기본 비공개, Firestore rules 변경 전 diff
- **자동 롤백** — 배포 실패 시 이전 리비전 복원
- **예산 가드** — 월 한도 설정, 초과 시 알림

## 로드맵

- [x] CLI 뼈대 + `--output json`
- [x] GCP 인증 (ADC)
- [x] Cloud Run / Firebase 커넥터
- [ ] **Phase 1 (MVP)**: init + link + deploy + admin surface (budget/secret/iam/notify)
- [ ] Phase 2: Firestore, Cloud Storage, Secret Manager 심화
- [ ] Phase 3: Gemini (Vertex AI) 네이티브 통합
- [ ] Phase 4: Stitch (디자인), DESIGN.md 워크플로우
- [ ] Phase 5: Google Analytics, Ads 연결
- [ ] Phase 6: 전체 라이프사이클 오케스트레이션

## 문서

| | |
|---|---|
| [PRD.md](./PRD.md) | 포지셔닝, MVP 범위, 전체 비전 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 기술 설계, 모듈 구조 |
| [AGENTS.md](./AGENTS.md) | AI 에이전트용 사용 가이드 |
| [PLAN.md](./PLAN.md) | Phase별 구현 계획 |

## 배경

oh-my 시리즈 (omc/omo/omx)에서 영감받았지만 특정 툴의 플러그인이 아닌 **독립 CLI**. 각 에이전트에는 얇은 플러그인 형태로 번들됨.

[oh-my-antigravity](https://github.com/TurnaboutHero/oh-my-antigravity)에서 서브에이전트 부재로 오케스트레이션이 막혔던 경험이 시작점.

## License

MIT
