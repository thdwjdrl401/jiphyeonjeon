# 실행 가이드 (RUN)

루트에서 프론트엔드(React) + 백엔드(Spring)를 실행하기 위한 가이드. 전체 개요는 [README.md](./README.md), 인프라·스캐폴드 상세는 [docs/T0-BOOTSTRAP.md](./docs/T0-BOOTSTRAP.md) 참고.

> **FE/BE 분리** 아키텍처 — 프론트(Vite dev, 8083)와 백엔드(Spring API, 8080)는 **따로** 뜬다(단일 포트 통합 서빙 없음). 프론트는 `/api`을 8080으로 프록시.

## 1. 사전 요구
| 구분 | 요구사항 | 비고 |
| ---- | ---- | ---- |
| **JDK** | Java **21** (LTS) | Spring Boot 4.1 ([ADR-0009](./docs/decisions/0009-java21-spring-boot-3.md)). Gradle 8.14+/9.x는 wrapper가 자동 |
| **Node.js** | 20+ / npm | 프론트(Vite). **WSL에서 개발하면 WSL 안에 설치** (`brew install node` 등) |
| **Docker** | Engine + compose | 인프라(Postgres+pgvector·Redis) |
| **VSCode 확장** | `Extension Pack for Java` · `ESLint` | 추천 팝업(`.vscode/extensions.json`) |

> ⚠️ **WSL 개발**: 레포를 WSL ext4에 두고 작업하면 `java`·`node`가 WSL 안에 있어야 한다(Windows쪽만 있으면 안 잡히거나 느림). JDK는 `JAVA_HOME`(예: brew는 `.../opt/openjdk@21/libexec`)을 PATH에 등록.

## 2. 최초 셋업
```bash
# 인프라 (PG+pgvector, Redis) — 최초 기동 시 core/ai 스키마 자동 생성
cp .env.example .env
docker compose up -d
docker compose ps               # postgres·redis healthy 확인

# 의존성
npm run install:all             # 루트(concurrently) + frontend
```

## 3. 실행

### 방법 A. 터미널 (루트에서 동시)
| 환경 | 개발 모드(FE+BE 동시) | 백엔드만 빌드 |
| ---- | ---- | ---- |
| **WSL** (권장) | `npm run dev:wsl` | `npm run build:wsl` |
| Windows | `npm run dev` | `npm run build` |

- `dev`/`dev:wsl` = 프론트 Vite(8083, HMR) + 백엔드 `bootRun`(8080, DevTools 핫리로드) 동시.
- WSL에서 `Permission denied: ./gradlew` → `chmod +x backend/gradlew` 한 번.
- **인프라(docker compose)가 먼저 떠 있어야** 백엔드가 PG/Redis에 붙는다.

### 방법 B. VSCode 실행 버튼
1. `Extension Pack for Java` 설치(추천 팝업).
2. **실행 및 디버그** 패널 → **`Spring Boot (Backend)`**(= `com.liveclass.LiveClassApplication`) ▶ → 백엔드 8080.
3. 프론트+백엔드 동시는 **`Full Stack (BE + FE)`** 컴파운드 실행(`.vscode/launch.json`).
> VSCode(Remote-WSL)가 `backend/`를 Gradle 프로젝트 `liveclass`로 자동 import. Java 런타임 **JDK 21**.

## 4. 포트
| 서비스 | 포트 | 설명 |
| ---- | ---- | ---- |
| Spring Boot (API) | 8080 | 백엔드 REST/WS |
| React (Vite dev) | 8083 | 프론트 dev, `/api`→8080 프록시 |
| PostgreSQL + pgvector | 5432 | DB (`liveclass`) |
| Redis | 6379 | 세션·캐시 |

> 미디어(LiveKit/Egress)는 별도 원격 호스트 — [infra/livekit/README.md](./infra/livekit/README.md).

## 5. 스모크 확인 (백엔드)
```bash
curl -s localhost:8080/actuator/health          # {"status":"UP"}
curl -s localhost:8080/api/ping               # {"status":"ok","app":"liveclass"}
curl -s -i localhost:8080/api/session/touch | grep -i set-cookie   # LIVECLASS_SESSION 발급
docker exec liveclass-redis redis-cli --scan --pattern 'liveclass:session:*'   # Redis에 세션
```

## 6. 트러블슈팅
- **`java: command not found`(WSL)**: JDK가 Windows쪽에만 있음. WSL에 설치 + `JAVA_HOME`/PATH 등록(brew openjdk는 keg-only).
- **DB 인증 실패 `password authentication failed`**: PG 볼륨이 옛 비번으로 init됨. `.env`의 `POSTGRES_PASSWORD`와 실제 볼륨 비번 불일치 → `docker compose down -v && up`(재초기화) 또는 `ALTER USER liveclass PASSWORD 'liveclass'`.
- **Flyway/세션이 안 켜짐(Boot 4.x)**: `flyway-core`·`spring-session-data-redis` 단독으론 부족 → `spring-boot-starter-flyway`·`spring-boot-starter-session-data-redis` 필요(이미 반영).
- **WSL에서 Windows npm(`/mnt/c/...`)이 잡힘**: `which node`/`which npm` 확인 후 WSL 내부에 Node 설치, 터미널 재시작.
- **포트 충돌**: 8080·8083·5432·6379.
- **백엔드 로그**: `backend/logs/`(git 무시).
