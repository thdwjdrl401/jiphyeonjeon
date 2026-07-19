# ADR-0015: EC2 배포 — 전부 Docker + nginx(SSL 종단·`/api` 프록시) + Let's Encrypt

> 📍 하네스 개요: [../harness/README.md](../../harness/README.md) · 판단 정책: [../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-07-17
- **관련**: Sub Ⅱ 배포, [ADR-0002](0002-react-typescript-frontend.md)(FE/BE 분리로 개정됨), [ADR-0009](0009-java21-spring-boot-3.md), [ADR-0014](0014-auth-redis-session-cookie.md), [ADR-0004](0004-media-livekit-selfhost.md), [RUN.md](../../../RUN.md)

## 맥락 (Context)
부트캠프 EC2(`jiphyeonjeon.thdwjdrl.com`, Ubuntu 24.04, 4vCPU/15GB)에 cp 앱(Spring Boot 4.1 + React/Vite + Postgres/Redis)을 배포해야 한다. 제약:
- 프론트 axios `baseURL='/api'` **상대경로** + 쿠키 세션(`withCredentials`, [ADR-0014](0014-auth-redis-session-cookie.md)) → API를 **같은 오리진**에서 서빙해야 CSRF/쿠키가 단순해진다.
- `application.yml`의 DB/Redis 접속이 `localhost` 하드코딩 → 컨테이너에선 환경변수 override 필요.
- Flyway가 기동 시 마이그레이션 → DB가 먼저 준비돼야 한다.
- 도메인은 `jiphyeonjeon.thdwjdrl.com` **단일**, DNS 콘솔 관리 권한 없음(서브도메인 불가).

## 결정 (Decision)
**앱 전체를 Docker Compose로 배포**한다(`docker-compose.prod.yml`, dev용 `docker-compose.yml`과 별개):
- **frontend 컨테이너(nginx)** 가 SSL을 종단하고, 정적 SPA를 서빙하며 `/api/`를 `backend:8080`으로 리버스 프록시한다(dev의 Vite `server.proxy` 대체). SPA 라우팅은 `try_files … /index.html` fallback.
- **backend**는 멀티스테이지 이미지(`gradlew bootJar` → JRE)로 빌드, DB/Redis 접속·쿠키 Secure를 **환경변수로 주입**, `depends_on: service_healthy`로 Postgres/Redis 준비 후 기동.
- **HTTPS**는 Let's Encrypt(certbot). 최초 발급은 `scripts/init-letsencrypt.sh`(standalone), 갱신은 certbot 컨테이너가 webroot로 자동 처리.
- nginx 프록시 위치는 **`/api/` prefix**로 잡는다. 경로 버저닝 제거(`/api/v1`→`/api`)는 [ADR-0016](0016-drop-api-path-versioning.md)에서 완료했으며, prefix 프록시라 그 변경과 무관하게 nginx는 불변이다.
- **미디어(LiveKit/Egress)는 이 스택에 포함하지 않는다** — `network_mode: host`·독립 라이프사이클이라 별도 스택으로 운영([ADR-0004](0004-media-livekit-selfhost.md), `infra/livekit/`). 단일 도메인 제약상 시그널링은 별도 TLS 포트(`wss://jiphyeonjeon.thdwjdrl.com:7443`)로 분리하고, 앱 스택이 발급한 인증서 볼륨(`liveclass_certbot_etc`)을 읽기전용 공유한다.

> 본 ADR은 [ADR-0002](0002-react-typescript-frontend.md)의 "Vite 산출물을 `backend/src/main/resources/dist`에 넣어 Spring Boot가 단일 포트로 SPA+API를 서빙"하던 통합 배포 서술이 이미 폐기(2026-07-16 개정)된 것을 전제로, 그 대체 아키텍처(FE/BE 분리·nginx 프록시)를 구체화한다.

## 근거 (Rationale)
- **same-origin 유지**: nginx가 `/api`를 프록시하면 프론트는 상대경로 그대로 → 쿠키 세션·CSRF가 단순하고 CORS 불필요. 프론트 `baseURL` 계약과 그 테스트도 정합.
- **전부 Docker**: 서버엔 Docker만 있으면 됨(JDK/Node 미설치, 깨끗). `git pull && up -d --build`로 재배포. 후속 CI/CD 연결 쉬움.
- **prod/dev compose 분리**: dev 워크플로(`docker-compose.yml`, PG/Redis 호스트 노출)를 건드리지 않는다. prod는 PG/Redis를 내부 네트워크로만 두어 노출면 축소.
- **certbot 자동 갱신**: 90일 만료를 사람이 챙기지 않도록 컨테이너가 갱신.

## 대안 (Alternatives)
| 대안 | 장점 | 단점 |
|---|---|---|
| **전부 Docker + nginx 프록시 (선택)** | 서버 깨끗·재현성·same-origin·재배포 단순 | Dockerfile/compose 초기 작성 필요 |
| 하이브리드(PG/Redis만 Docker + 서버에 jar/정적 직접) | 최초 구동 빠름 | 서버에 JDK/Node 오염, 재배포 수작업, 환경 드리프트 |
| Spring 통합 서빙(dist→resources 단일 포트) | 프록시 불필요 | ADR-0002에서 이미 폐기(FE/BE 분리 방향과 상충), 프론트 독립 배포 불가 |
| HTTP만(HTTPS 미적용) | 셋업 최소 | 쿠키 Secure 불가·평문, 운영 부적합 |

## 영향·후속 (Consequences)
- **추가 파일**: `backend/Dockerfile`·`.dockerignore`, `frontend/Dockerfile`·`.dockerignore`·`nginx/default.conf`, `docker-compose.prod.yml`, `.env.prod.example`, `scripts/init-letsencrypt.sh`.
- **비밀값**: `.env.prod`(gitignore). `POSTGRES_PASSWORD`는 운영에서 강한 값으로.
- **하네스**: 인프라 파일이라 계약 테스트 대상 아님([POLICY](../../harness/POLICY.md)). 프론트 테스트(`baseURL==='/api'`)는 `/api/` 프록시와 정합 → 영향 없음.
- **후속**: ① ~~API 경로 de-versioning~~ → [ADR-0016](0016-drop-api-path-versioning.md)으로 완료. ② Egress 저장소 MinIO→실 S3 교체. ③ GitLab CI/CD 자동 배포.
