# T0 부트스트랩 — 인프라 · 백엔드 scaffold · 미디어 PoC

> 📍 확정 아키텍처: [ARCHITECTURE.md](ARCHITECTURE.md) · 로드맵: [CP-ROADMAP.md](CP-ROADMAP.md) · 백엔드 규칙: [../backend/AGENTS.md](../backend/AGENTS.md)
>
> T0 = 실행 기반. **앱 플레인(로컬)** 과 **미디어 플레인(공유 원격 1대)** 로 나눈다. 무거운 것(RabbitMQ·MinIO·nginx)은 각 CP 착수 시점에 확장([CP-ROADMAP](CP-ROADMAP.md)·TEAM-KICKOFF §4).

---

## 1. 인프라 backbone (로컬, 최소)

CP0가 쓰는 것만: **Postgres+pgvector · Redis**. 루트 [`docker-compose.yml`](../docker-compose.yml).

현재 상태: 루트 `docker-compose.yml`에는 postgres·redis·minio·rabbitmq·media-worker·recorded-stt-worker가 함께 정의돼 있다(실행법은 [RUN.md](../RUN.md)).

```bash
cp .env.example .env          # 값 확인/수정 (.env는 git 무시)
docker compose up -d
docker compose ps             # postgres·redis 'healthy' 확인
docker compose config         # (참고) 구문 검증
```

- Postgres: `pgvector/pgvector:pg16`, `localhost:5432`, DB `liveclass`. 최초 기동 시 [`infra/postgres/init/01-schema.sql`](../infra/postgres/init/01-schema.sql)가 `vector` 확장 + `core`/`ai` 스키마를 만든다.
- Redis: `redis:7-alpine`, `localhost:6379`, `appendonly`(세션 재시작 생존).
- 테이블은 **마이그레이션이 생성**: Flyway(core, Spring) / Alembic(ai, Python). 스키마 공동수정 금지([ADR-0006](decisions/songjeongki/0006-backend-spring-plus-python-ai.md)).

---

## 2. 백엔드 Spring Boot 4.1 / Java 21 scaffold

**방식: 버전 bump 아니라 fresh scaffold.** 기존 `backend/`(Spring 2.7·Java11·Kurento·QueryDSL·MySQL)는 도메인 재사용이 없어 새로 초기화하는 게 빠르다. Gradle은 유지.

### 2-1. `start.spring.io` 의존성
- **Web · Security · Data JPA · PostgreSQL Driver · Validation · Actuator · Flyway**
- **Spring Session Data Redis** (쿠키 세션 저장 — [ADR-0014 인증](decisions/)) · **Spring Data Redis**
- 선택: Lombok · DevTools
- Java **21** 툴체인, Spring Boot **4.1** (버전 근거 [ADR-0009](decisions/songjeongki/0009-java21-spring-boot-3.md)), Gradle **8.14+/9.x**.

### 2-2. 핵심 설정 (`application.yml`)
```yaml
spring:
  threads:
    virtual:
      enabled: true            # Java 21 virtual threads (ADR-0009)
  datasource:
    url: jdbc:postgresql://localhost:5432/liveclass
    username: liveclass
    password: liveclass          # 로컬 dev 전용 (.env와 일치)
  jpa:
    properties:
      hibernate.default_schema: core
  flyway:
    schemas: [core]
    default-schema: core       # 마이그레이션 대상 = core (ai는 Python/Alembic)
  session:
    store-type: redis          # 세션 본체 → Redis (앱 무상태)
  data:
    redis:
      host: localhost
      port: 6379
server:
  port: 8080
  servlet:
    session:
      cookie:
        http-only: true
        same-site: lax         # dev/prod 프록시로 same-origin
        secure: false          # prod(https)에서 true
```

### 2-3. 인증 설정 포인트 (ADR-0014 반영)
- **쿠키 세션**: Spring Session Redis 자동 구성 → `LIVECLASS_SESSION` 쿠키(HttpOnly, `application.yml`의 `server.servlet.session.cookie.name`). `Authorization: Bearer`·localStorage 안 씀.
- **CSRF**: SPA 패턴 → `CookieCsrfTokenRepository.withHttpOnlyFalse()`(JS가 `XSRF-TOKEN` 읽어 헤더로 에코). 상태변경 요청에 적용.
- **CORS/프록시**: dev는 Vite 프록시로 `/api`→8080 **same-origin** 권장(쿠키·CSRF 단순). 분리 오리진 유지 시 `allowCredentials=true` + 정확한 origin.
- **필터 seam**: 인증 필터를 seam으로 → 향후 opaque↔JWT 교체는 필터만(ADR-0014).

### 2-4. 패키지 구조 (모듈러 모놀리스)
[backend/AGENTS.md](../backend/AGENTS.md) 대로 도메인 모듈(auth·curriculum·lesson·enrollment·learning·live·video·asset·aiintegration·notification·admin) 단일 배포, 모듈 간 ID/port로만 연결.

### 2-5. T0 완료 기준(스모크)
1. `./gradlew bootRun` 기동 → `GET /actuator/health` = UP.
2. Postgres 연결(Hibernate/Hikari) + **Flyway 설정 완료**. 첫 마이그레이션(core DDL)은 **CP0 DDL 설계 후** 작성(스캐폴드엔 임의 DDL 미포함).
3. 세션 스모크(`GET /api/session/touch`) → **HttpOnly 쿠키 발급 + Redis 세션 키**(`liveclass:session:*`) 확인. 현재 상태: 스모크 컨트롤러는 제거됐고 세션은 `POST /api/auth/login`으로 발급된다.
> 전체 인증·강좌 도메인은 CP0에서. T0는 "붙고 뜬다"까지만.

---

## 3. 미디어 원격 PoC (LiveKit + Egress + TURN)

### 3-1. 왜 원격 1대인가
- **Egress는 Linux 전용**(헤드리스 Chromium) — Windows 네이티브 불가.
- **WebRTC는 공인 IP 도달**이 필요 — 각자 로컬(WSL/NAT 뒤)은 서로 못 붙음.
- → **미디어 플레인만 공유 원격 Linux 1대**(클라우드 VM/개인서버), 앱은 URL로 접속. ([ADR-0004](decisions/songjeongki/0004-media-livekit-selfhost.md)·[0010](decisions/songjeongki/0010-self-host-vod.md))

### 3-2. ⭐ 정본은 공식 생성기 — 손으로 config 쓰지 말 것
LiveKit 공식 배포 경로는 **설정 생성기**다. 실제 배포 config(compose·Caddy·livekit.yaml·egress.yaml)는 이걸로 만든다:
```bash
docker run --rm -it -v $PWD:/output livekit/generate
# 물어보는 것: 메인 도메인(wss), TURN 서브도메인 → 둘 다 미리 VM IP로 DNS 설정
```
아래 3-3~3-6은 **생성기가 왜 그렇게 만드는지 이해**하기 위한 지도이지, 복붙용 정본이 아니다.

### 3-3. 사전 준비
- **VM**: Egress 권장 사양이 인스턴스당 **4 CPU / 4 GB**라, LiveKit+Redis+Egress 합치면 **4vCPU / 8GB 이상** 권장. Docker + docker compose.
- **도메인 2개**: 메인(`livekit.example.com`)·TURN(`turn.example.com`) 둘 다 VM 공인 IP로 A레코드 → Caddy/Let's Encrypt가 인증서 발급.

### 3-4. 포트/방화벽
| 포트 | 프로토콜 | 컴포넌트 | 용도 |
|---|---|---|---|
| 443 / 80 | TCP | Caddy | HTTPS/WSS 역프록시 + ACME(인증서) |
| 7880 | TCP | livekit | 시그널링(WS) — 프로덕션은 TLS 뒤 |
| 7881 | TCP | livekit | ICE/TCP fallback (LB/TLS 없이 직접 노출) |
| 50000–60000 | UDP | livekit | ICE/RTC 미디어 |
| 3478 | UDP | 내장 TURN | TURN/UDP (turn.enabled 시) |
| 5349 | TCP | 내장 TURN | TURN/TLS (turn.enabled 시) |
| 6379 | TCP | Redis | livekit↔egress 공유 — **외부 노출 금지** |

- **TURN은 LiveKit 내장** — `livekit.yaml`의 `turn.enabled: true`로 켬. 별도 coturn 불필요(단일 서버 PoC).

### 3-5. TLS/WSS 함정 (필수)
브라우저는 카메라·마이크(`getUserMedia`)에 **secure context**(https 또는 `localhost`)를 요구한다.
- **무TLS는 `localhost`에서만 가능** → 감 잡기용으로 `livekit-server --dev`(127.0.0.1:7880, devkey) 로컬 먼저.
- **원격 IP·도메인 http로 열면 브라우저가 캠/마이크 차단** → 원격 PoC는 **도메인 + TLS(Caddy+Let's Encrypt) 필수.** 생성기가 Caddy를 세팅해 준다.

### 3-6. Egress 주의
- **별도 컨테이너**(`livekit/egress`), **livekit-server와 같은 Redis 공유**로만 연결(livekit.yaml엔 egress 블록 없음).
- docker에 **`cap_add: SYS_ADMIN`** 필요(Chromium 샌드박스) — 로컬/PoC도.
- 녹화 **S3/MinIO sink는 요청(StartRoomCompositeEgress)마다 지정 가능**(`endpoint`에 MinIO URL) — config 기본값은 fallback. 즉 Spring이 Egress 제어 시 버킷/엔드포인트를 실어 보낸다.

### 3-7. 진행 순서 · 완료 기준
1. **로컬 감잡기**: `livekit-server --dev` + LiveKit 예제 클라(localhost)로 화상 publish/subscribe 확인.
2. **VM 배포**: `livekit/generate` → 나온 compose 기동 → 브라우저(도메인 https)에서 2개 탭 화상 연결.
3. **녹화**: Egress로 방 녹화 → MinIO/S3에 파일 생성 확인.
4. **앱 연동(CP1)**: Spring이 토큰 발급 + Egress 제어. 앱은 `wss://livekit.example.com` + API secret로 접속.

> ⚠️ **CHECK**: 3-4~3-6 값은 공식 문서/샘플 기준이나 버전에 따라 필드·태그가 바뀔 수 있음. `livekit/generate` 산출물과 [docs.livekit.io](https://docs.livekit.io/deploy/vm)를 정본으로 삼고 대조할 것. 이미지 태그는 livekit-server·egress가 독립 버전이니 각 릴리스 노트 확인.

---

## 착수 매핑
- **1·2 = 로컬 앱 backbone** (BE 리드) → CP0 착수 토대.
- **3 = 미디어 원격 PoC** (병렬, 서버 담당) → CP1 라이브 미디어 토대.
- RabbitMQ·MinIO·nginx·ai 서비스는 CP2~CP4 착수 시 compose에 확장.
