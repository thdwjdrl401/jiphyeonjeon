# AGENTS.md — 팀 공통 AI 하네스 (정본)

> 📍 하네스 개요·온보딩: [docs/harness/README.md](docs/harness/README.md)
>
> **이 파일이 정본입니다.** 어떤 AI 코딩 도구(Claude Code / Codex / Cursor / Gemini 등)를 쓰든
> 이 규칙을 따릅니다. 도구별 연결법은 위 README의 "도구별 링킹" 표를 참고하세요.

실시간 온라인 강의 플랫폼 **LiveClass AI** — VOD 학습(강좌·자막·RAG·퀴즈) 코어 + 실시간 WebRTC. React + Spring Boot(Java 21) + Python AI + LiveKit. 부트캠프 팀 프로젝트.

> **기존 PJT 명세서·스켈레톤 코드는 참고용이다.** 본 기획에 맞춰 제로베이스로 재설계한다(구조 포함). 명세·스켈레톤 준수를 완료 기준으로 삼지 않는다. 근거: [docs/decisions/songjeongki/0003-greenfield-redesign.md](docs/decisions/songjeongki/0003-greenfield-redesign.md) · 확정 아키텍처: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## 0. AI 작업 순서

AI 에이전트는 작업을 시작할 때 아래 순서로 문서를 확인한다.

1. 루트 `AGENTS.md`를 최상위 운영 규칙으로 따른다.
2. `backend/` 작업이면 `backend/AGENTS.md`, `frontend/` 작업이면 `frontend/AGENTS.md`를 함께 따른다.
3. API 요청/응답 필드, 상태코드, 공유 DTO, URL prefix를 바꾸면 `docs/CONTRACT.md`를 확인하고 FE/BE 양쪽을 함께 반영한다.
4. 테스트·린트가 필요한지 애매하면 `docs/harness/POLICY.md`로 판단한다.
5. 필요한 자물쇠는 `docs/harness/ENFORCEMENT.md` 절차로 켠다.
6. 완료 보고 전 이 문서의 "완료 게이트"를 확인한다.

Codex는 별도 명령 어댑터 없이 위 문서 흐름을 기준으로 판단한다.

---

## 1. 프로젝트 한눈에

| 구분 | 스택 | 위치 |
|---|---|---|
| Frontend | React 19 · TypeScript · Vite (FE/BE 분리, TanStack Query, SSE/WS) | `frontend/` ([frontend/AGENTS.md](frontend/AGENTS.md)) |
| Backend (컨트롤) | **Spring Boot 4.1 · Java 21**(virtual threads) · JPA · Security | `backend/` ([backend/AGENTS.md](backend/AGENTS.md)) |
| AI | Python: **ai-api(FastAPI SSE)** · **ai-worker(RabbitMQ)** · **realtime-agent(LiveKit)** | — |
| DB | PostgreSQL + pgvector (**core/ai 스키마 분리**) | — |
| 큐·캐시 | **RabbitMQ**(durable 배치) · **Redis**(cache/session + STT·라이브 fast path) | — |
| 미디어 | **LiveKit self-host(SFU) + Egress(라이브 녹화→HLS) + media-worker(업로드 MP4→HLS) + MinIO + nginx** | `media-worker/` |

- **확정 아키텍처·다이어그램**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · 실행법: [RUN.md](RUN.md)
- 마일스톤(CP): **CP0**(인증·강좌) → **CP1**(라이브 미디어) → **CP2**(자막) → **CP3**(용어·RAG) → **CP4**(녹화·다시보기) → **CP5**(퀴즈). 상세는 [docs/CP-ROADMAP.md](docs/CP-ROADMAP.md).
---

## 2. 반드시 지킬 공유 계약 (요약)

전체·정본은 [docs/CONTRACT.md](docs/CONTRACT.md). 아래는 어길 시 FE/BE가 깨지는 핵심만.

- **API 필드명은 `camelCase`로 통일** (팀 자체 컨벤션). 근거: [docs/decisions/songjeongki/0001-field-name-camelcase.md](docs/decisions/songjeongki/0001-field-name-camelcase.md)
- **API prefix**: `/api`.
- **HTTP 상태코드 규격을 지킨다** (예: 회원가입 **201**, 중복확인 **409**, 로그인 실패 **401**). CONTRACT의 상태코드 표 참조.
- FE/BE가 공유하는 DTO/응답 형태를 바꿀 때는 **양쪽을 함께** 바꾸고 CONTRACT를 갱신한다.

---

## 3. 작업 판단 정책 (언제 테스트/린트를 채우나)

정본은 [docs/harness/POLICY.md](docs/harness/POLICY.md). 요지:

| 상황 | 필요한 것 |
|---|---|
| 실제 API JSON 필드명·상태코드처럼 FE/BE 런타임 계약 | **계약 테스트** (필드명·상태코드 검증) |
| 마일스톤(CP) 완료 게이트 핵심 경로(로그인, 세션 생성/입장) | **계약 테스트** |
| 코드 식별자 같은 정적 규칙(camelCase, import 순서, 미사용 변수) | **린트로 충분** |
| 표준 CRUD·내부 헬퍼·UI 문구 | **불필요** (근거만 남김) |

자물쇠(린트/훅/테스트)를 실제로 켜는 방법은 [docs/harness/ENFORCEMENT.md](docs/harness/ENFORCEMENT.md).

---

## 4. 완료 게이트 (기능 "완료" 선언 전 필수)

아래를 만족하지 않으면 완료가 아니다. AI 에이전트는 완료 보고 시 이 항목을 명시한다.

1. **계약 검증**: 계약이 걸린 기능이면 테스트 통과 증거를 첨부. 계약이 없다면 "왜 불필요한지" 한 줄 근거.
2. **결정 기록**: 기술 결정·판단(라이브러리 선택, 🟡 항목 확정, 테스트 채택/생략 등)이 있었으면 [docs/decisions/](docs/decisions/)에 ADR을 남기고 **번호를 명시**.
3. **가짜 완료 금지**: `TODO`/`test.skip`/`@Disabled`/빈 스텁을 "완료"로 보고하지 않는다. 미구현은 블로커로 보고한다.

---

## 5. 브랜치·커밋·PR 규칙

### 브랜치 이름

형식: `{type}/{scope}/{description}` (예: `feat/ai/streaming-caption`)

- **type**: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
- **scope**: `fe`, `be`, `ai`, `common`
  - 여러 영역을 함께 건드리는 변경은 `common`을 사용한다.
- **description**: 영문 kebab-case로 작성한다.
- 하나의 브랜치는 하나의 영역만 담당한다.

### 커밋·PR

- **커밋 메시지**: 한글, `<타입>: <제목>` (타입: feat/fix/refactor/style/docs/chore/test). 상세는 [.gitcommit_template.txt](.gitcommit_template.txt).
- **PR**: [PR 템플릿](.github/PULL_REQUEST_TEMPLATE.md)의 하네스 체크리스트를 채운다. GitHub로 옮긴 뒤에는
  PR 본문이 이 템플릿으로 자동으로 채워진다.
- 공유 계약 파일(`AGENTS.md`, `docs/CONTRACT.md`)은 [CODEOWNERS](CODEOWNERS)에 따라 리드 승인이 필요하다.

### 번호를 새로 집을 때 (마이그레이션·ADR)

브랜치 두 개가 각자 **같은 번호**를 집으면 git은 파일명이 달라 조용히 병합하고, 그 결과 Flyway가
기동을 거부해 **운영이 내려간다**(2026-07-31·2026-08-03 실제 발생). ADR은 기동을 막지는 않지만
`ADR-NNNN` 참조가 어디를 가리키는지 알 수 없게 만든다.

- 새 번호를 집기 전에 **`master`와 열린 PR을 함께** 확인한다. 로컬 파일 목록만 보면 놓친다
  (`gh pr list`, 또는 `git ls-remote --heads origin`으로 열린 브랜치를 훑는다).
- CI `check-collisions`가 대상 브랜치와 대조해 막는다. 로컬 확인은 `bash scripts/check-version-collisions.sh`.
- 충돌이 났으면 **이미 적용·머지된 쪽은 그대로 두고 내 번호만** 올린다. 운영에 적용된 마이그레이션
  번호를 바꾸면 `flyway_schema_history`와 어긋나 더 크게 깨진다.
- ADR 번호는 **저자 폴더별**이라 폴더가 다르면 같은 번호여도 충돌이 아니다.
- 검사가 통과한 뒤 머지 전에 `master`가 움직이면 검사는 그 변화를 보지 못한다. 그래서 `master`가
  앞서 있으면 **rebase 후 재검사**를 거쳐야 머지된다 — GitHub에서는 브랜치 보호 규칙의
  **Require branches to be up to date before merging**이 그 자물쇠다(GitLab 시절에는 Merge method
  "반선형 이력"이 같은 일을 했다). 근거는
  [ADR-0069](docs/decisions/songjeongki/0069-number-collisions-close-the-merge-window.md).

---

## 6. 강제(자물쇠)는 도구 중립 레이어에 있다

팀원마다 AI 도구가 다르므로, 규칙 강제는 특정 도구가 아니라 **git 훅·lint/test 스크립트·PR 체크리스트**에 둔다. AI 도구 설정(`.claude/`·`.cursor/`·`.gemini/`·`CLAUDE.md`·`GEMINI.md`)은 정본을 가리키는 **얇은 어댑터**이며, 없어도 안전망이 유지된다. 활성화·주의사항은 [docs/harness/ENFORCEMENT.md](docs/harness/ENFORCEMENT.md).

## 7. 문서 최신화 규칙 (표류 방지)

문서·계약이 코드나 서로에 대해 뒤처지지 않게 아래를 지킨다. 기계 검사는 [ENFORCEMENT §G](docs/harness/ENFORCEMENT.md#g-문서-최신화-자물쇠-표류-방지).

- **단일 원본(SSOT)**: 규칙·계약·판단 기준은 정본 문서(`AGENTS.md`·`CONTRACT.md`·`POLICY.md`)에만 둔다. 도구 어댑터(`.claude/`·`.cursor/`·`GEMINI.md` 등)·README에 **복제 금지** — 가리키기만 한다.
- **동반 수정**: API 요청/응답 필드·상태코드를 바꾸면 같은 변경에서 `CONTRACT.md`를 갱신하고 FE/BE **양쪽**을 함께 고친다.
- **결정은 즉시 기록**: 🟡 항목·기술 선택을 확정하면 그 자리에서 [docs/decisions/](docs/decisions/)에 ADR을 남긴다(나중으로 미루지 않기).
- **링크 무결성**: 문서를 옮기거나 지우면 참조를 함께 고친다(링크 검사가 커밋에서 잡는다).
- **어댑터 갱신은 정본에서**: 판단 로직이 바뀌면 어댑터가 아니라 `POLICY.md`를 고친다. 어댑터는 그대로 둔다.
