# LiveClass AI

**실시간 라이브 강의 플랫폼** — 강사가 WebRTC로 라이브 강의하고, 실시간 **자막·용어·자료 근거 RAG**를 제공한다. 지난 강의는 **녹화 다시보기**(교정된 자막·용어·RAG 포함)로 재생한다. **영상 업로드는 없다**(콘텐츠는 라이브+녹화, 자료 PPTX만 업로드).

> 기존 부트캠프 화상회의 스켈레톤을 참고용으로만 두고 본 기획으로 제로베이스 재설계했다([docs/decisions/0003](docs/decisions/0003-greenfield-redesign.md)). 현재 **설계 확정 → 착수 전환 단계**이며, 스캐폴딩 마이그레이션·인프라 구성은 [CP-ROADMAP](docs/CP-ROADMAP.md)의 T0부터 진행한다.

## 📚 정본 문서 (여기부터 읽기)

| 문서 | 내용 |
| ---- | ---- |
| **[AGENTS.md](AGENTS.md)** | **규칙 정본** — 프로젝트 규칙·완료 게이트·커밋 규칙 (모든 AI 도구 공통) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 확정 아키텍처 기준선(스택·플레인 분리·데이터플로우·도메인) |
| [docs/CP-ROADMAP.md](docs/CP-ROADMAP.md) | 착수 순서·의존성·역할(T0 → CP0~CP5) |
| [docs/CONTRACT.md](docs/CONTRACT.md) | 공유 계약(FE↔Spring, Spring↔AI) — SSOT |
| [docs/decisions/](docs/decisions/) | 기술 결정 ADR(0001~0014) |
| [docs/harness/README.md](docs/harness/README.md) | 하네스(계약·판단·강제) 프로세스 |
| [docs/TEAM-KICKOFF.md](docs/TEAM-KICKOFF.md) | 역할 배분·타임라인·협업 규칙 |

## 1. 확정 스택

| 구분 | 기술 | 근거 ADR |
| ---- | ---- | ---- |
| Frontend | **React 19 + TypeScript**, Vite, TanStack Query, SSE/WS, LiveKit client | [0002](docs/decisions/0002-react-typescript-frontend.md) |
| Backend | **Spring Boot 3.4/3.5 + Java 21**(virtual threads), JPA, Security | [0006](docs/decisions/0006-backend-spring-plus-python-ai.md)·[0009](docs/decisions/0009-java21-spring-boot-3.md) |
| AI | **Python 3서비스** — realtime-agent(라이브 STT) · ai-api(FastAPI, RAG SSE) · ai-worker(RabbitMQ, chunk·embed·후보) | [0011](docs/decisions/0011-ai-three-services.md) |
| Database | **PostgreSQL + pgvector** (core/ai 스키마 분리) | [0005](docs/decisions/0005-db-postgres-pgvector.md) |
| Cache·Queue | **Redis**(cache/session + STT/라이브 Streams) · **RabbitMQ**(durable 배치 잡) | [0008](docs/decisions/0008-ai-bus-redis-streams-session-clock.md)·[0012](docs/decisions/0012-hybrid-queue.md) |
| Media | **LiveKit self-host(SFU) + Egress(녹화→HLS) + MinIO + nginx** | [0004](docs/decisions/0004-media-livekit-selfhost.md)·[0010](docs/decisions/0010-self-host-vod.md) |
| Auth | **HttpOnly 쿠키 + Redis 세션**(엣지) · 내부 S2S=단명 JWT · 미디어=LiveKit JWT | [0014](docs/decisions/0014-auth-redis-session-cookie.md) |

- 배포: 모듈러 모놀리스(Spring 단일 배포) + 폴리글랏 모노레포.

## 2. 디렉터리 구조 (모노레포)

```
cp/
├── AGENTS.md          # 규칙 정본 (도구별 어댑터: CLAUDE.md·GEMINI.md·.cursor 등)
├── backend/           # Spring Boot (컨트롤/데이터 플레인) — backend/AGENTS.md
├── frontend/          # React + TypeScript — frontend/AGENTS.md
├── ai/                # Python AI 3서비스 (예정 — 착수 시 생성)
└── docs/              # 아키텍처·로드맵·계약·ADR·하네스 (정본)
```

## 3. 실행

개발자 환경은 전원 Windows 기준(`gradlew.bat`), WSL은 `:wsl` 변형 스크립트 사용.

```bash
# 최초 1회 의존성 설치
npm run install:all

# 개발 모드 (FE HMR + BE 핫리로드 동시)  —  FE :8083 / BE :8080
npm run dev            # WSL: npm run dev:wsl

# 통합 구동 (FE 빌드 후 BE 단일 포트 :8080)
npm start              # WSL: npm start:wsl
```

- **빌드·테스트 상세**는 [backend/AGENTS.md](backend/AGENTS.md)·[frontend/AGENTS.md](frontend/AGENTS.md) 참고.
- **인프라(Postgres·Redis·RabbitMQ·MinIO·nginx)** 는 T0에서 docker-compose로 구성한다([CP-ROADMAP](docs/CP-ROADMAP.md)).
- **미디어 플레인(LiveKit·Egress·TURN)** 은 Egress가 Linux 전용·WebRTC가 공인 IP를 요구하므로 **공유 원격 호스트**에 올리고 앱은 URL로 접속한다([0004](docs/decisions/0004-media-livekit-selfhost.md)).

## 4. 주요 포트

| 서비스 | 포트 | 상태 |
| ---- | ---- | ---- |
| Spring Boot (HTTP·API) | 8080 | 현행 |
| React 개발 서버 | 8083 | 현행 |
| PostgreSQL / Redis / RabbitMQ / MinIO | 5432 / 6379 / 5672 / 9000 | T0 compose |
| LiveKit(SFU) / Egress / TURN | 7880 / — / 3478 | 원격 호스트 |

## 5. 기여 규칙

- **master는 보호 브랜치** — 브랜치 + MR + [하네스 체크리스트](.gitlab/merge_request_templates/merge_request_template.md) + CODEOWNERS.
- **계약 우선**: 인터페이스는 [CONTRACT.md](docs/CONTRACT.md)에서 먼저 합의 후 병렬 개발.
- **기술 결정은 ADR**([docs/decisions/](docs/decisions/)), 문서는 단일 원본(SSOT).
- 커밋은 한글 `<타입>: <제목>`. 상세는 [AGENTS.md](AGENTS.md).
