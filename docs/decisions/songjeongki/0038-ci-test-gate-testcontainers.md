# ADR-0038: CI 테스트 게이트 — Testcontainers 도입 + MR 파이프라인에 백엔드·프론트 테스트 추가

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-07-26
- **관련**: [0005](0005-db-postgres.md)(pgvector 이미지), [0022](0022-local-vs-ec2-infra-profile.md)(인프라 프로필), [backend/src/test/java/com/liveclass/LiveClassApplicationTests.java](../../../backend/src/test/java/com/liveclass/LiveClassApplicationTests.java)

## 맥락
- `.gitlab-ci.yml`의 MR 파이프라인은 prod 이미지가 빌드되는지만 확인했고 **테스트를 전혀 돌리지 않았다**. 계약 테스트 267개(39개 클래스)가 로컬 실행에만 의존해 왔다.
- 백엔드 테스트는 `@SpringBootTest` 컨텍스트가 Flyway로 실제 Postgres에 붙어야 해서, 콜드 체크아웃(로컬 compose 인프라가 없는 상태)에서는 233개가 연결 실패했다. `LiveClassApplicationTests`에 "CI 격리는 이후 Testcontainers로"라는 방향이 이미 적혀 있었다.
- 러너는 EC2 자체 러너, **shell executor**(tag `ec2-liveclass`)다. `image:`/`services:` 키워드가 동작하지 않고, docker 명령은 쓸 수 있다(build job이 이미 씀).
- 같은 EC2에 상시 스택(`docker-compose.yml`의 liveclass-postgres:5432·liveclass-redis:6379)이 떠 있어 **고정 포트로 인프라를 새로 띄우면 충돌**한다. Testcontainers는 랜덤 호스트 포트를 쓰므로 이 문제가 없다.
- DB 이미지는 `pgvector/pgvector:pg16`(마이그레이션이 pgvector 확장을 실제로 쓰지는 않지만 dev/prod와 이미지를 맞춰 둔다), Redis는 `redis:7-alpine` — 로컬 compose·prod와 동일 이미지.

## 결정
1. **Testcontainers를 backend 테스트 의존성으로 도입한다.** `spring-boot-testcontainers` + `org.testcontainers:testcontainers-postgresql`(Testcontainers 2.0부터 모듈명이 `testcontainers-postgresql`/`testcontainers-junit-jupiter`로 바뀜, Boot 4.1 BOM이 버전 관리) + `testcontainers-junit-jupiter`. Redis는 전용 스타터가 없으므로 `GenericContainer`(`redis:7-alpine`)를 `@ServiceConnection`으로 직접 노출한다 — Redis `@ServiceConnection` 매칭 팩토리(`RedisContainerConnectionDetailsFactory`)는 Boot 4.1에서 `spring-boot-data-redis` 모듈 안에 있어(오토컨피그가 기술별로 쪼개진 Boot 4 구조) 별도 의존성 추가 없이 이미 클래스패스에 있다.
2. **싱글턴 컨테이너를 스위트 전체가 공유하고, 전 테스트 클래스에 자동 적용한다.** `backend/src/test/java/com/liveclass/support/TestcontainersConfiguration.java`가 static 초기화에서 Postgres+Redis 컨테이너를 한 번만 start하고(`@Container` 라이프사이클 없음 — JVM 종료 시 Ryuk이 회수), `@Bean @ServiceConnection`으로 노출한다. `TestcontainersContextCustomizerFactory` + `META-INF/spring.factories`(키: `org.springframework.test.context.ContextCustomizerFactory`)가 이 설정을 **모든 `@SpringBootTest` 컨텍스트에 자동 주입**한다 — 39개 테스트 클래스 중 어느 것도 개별 수정하지 않는다.
3. **`.gitlab-ci.yml`에 `test` stage를 추가**하고 `build` stage 앞에 둔다. MR 파이프라인(`merge_request_event`)에서만, 그리고 **관련 경로가 바뀐 MR에서만** 실행되도록 `changes`를 건다(`test-backend`는 `backend/**/*`+`.gitlab-ci.yml`, `test-frontend`는 `frontend/**/*`+`.gitlab-ci.yml`) — 문서만 바꾼 MR이 전체 스위트를 돌리지 않는다. shell executor라 러너 호스트에 Java/Node가 있다는 보장이 없으므로 **컨테이너 안에서 빌드 도구를 실행**한다.
   - `test-backend`: `docker run --rm -v "$CI_PROJECT_DIR:$CI_PROJECT_DIR" -w "$CI_PROJECT_DIR/backend" -v /var/run/docker.sock:/var/run/docker.sock -v gradle-cache:/root/.gradle eclipse-temurin:21-jdk ./gradlew test --no-daemon`. Testcontainers가 컨테이너 안에서 호스트 docker 데몬에 형제 컨테이너를 띄우는 DooD(Docker-outside-of-Docker) 패턴이므로, 워크스페이스를 호스트와 **동일 경로**로 마운트한다(`$CI_PROJECT_DIR:$CI_PROJECT_DIR`) — 경로를 다르게 리매핑하면(예: `/workspace`) 호스트 데몬이 바인드 마운트 경로를 outer 컨테이너의 마운트 네임스페이스가 아니라 호스트 기준으로 해석해 어긋난다(Testcontainers 공식 DooD 가이드). `TESTCONTAINERS_HOST_OVERRIDE`·`TESTCONTAINERS_RYUK_DISABLED`는 표준 Linux dockerd에서는 불필요 — 게이트웨이 IP 자동 감지로 컨테이너 안에서 형제 컨테이너의 매핑 포트에 접근된다(이 두 변수는 Docker Desktop/Rancher Desktop/rootless Podman 전용 워크어라운드). `resource_group: backend-test`로 동시 MR 파이프라인이 겹쳐도 같은 `gradle-cache` named volume에 동시 접근하지 않게 직렬화한다(`deploy` job의 `resource_group: production`과 같은 패턴).
   - `test-frontend`: `docker run --rm -v "$CI_PROJECT_DIR/frontend:/app" -v frontend-node-modules:/app/node_modules -w /app node:22-alpine sh -c "npm ci && npx vitest run"`. `node_modules`를 별도 named volume(`frontend-node-modules`)으로 분리 마운트한다 — 그렇지 않으면 `npm ci`가 호스트 `frontend/node_modules`에 직접 설치해 Alpine(musl) 바이너리로 호스트 워크스페이스를 오염시키거나, 이전 실행의 잔존물이 다음 실행에 재사용돼 lockfile과 어긋날 수 있다.
   - gradle 캐시는 named volume(`gradle-cache`)으로 반복 실행 시간을 억제한다. 두 named volume 다 **root 사용자 전제**(컨테이너 이미지가 기본 root로 실행되고 `/var/run/docker.sock`·`/root/.gradle`에 접근) — 러너가 non-root로 docker를 실행하도록 바뀌면 볼륨 소유권 조정이 필요하다.
   - 기존 `build`·`deploy`·`deploy-livekit`·`deploy-dev-infra` job은 변경하지 않는다.
   - **운영 권고(후속)**: Ryuk 없이 도는 상황(로컬 워크어라운드)이나 파이프라인이 비정상 종료되는 경우 컨테이너가 러너 호스트에 누적될 수 있다. 러너에 `docker container prune --filter label=org.testcontainers=true` 같은 주기 실행(cron)을 두는 것을 권고한다(이번 범위에는 cron 설정 자체는 포함하지 않음 — 러너 인프라 프로비저닝 별도 작업).
4. **로컬 개발 흐름 변경**: `LiveClassApplicationTests`의 "docker compose up 상태에서 실행" 주석과 `RUN.md`의 테스트 안내를 갱신 — `./gradlew test`가 **로컬 compose 인프라 없이도** 전체 통과한다. Colima를 쓰는 macOS 로컬 환경은 기본 도커 소켓이 심볼릭 링크라 Ryuk의 소켓 바인드 마운트가 실패할 수 있어(`operation not supported`), 필요 시 `DOCKER_HOST`를 Colima 소켓으로 직접 지정 + `TESTCONTAINERS_RYUK_DISABLED=true`(로컬 한정 워크어라운드, 컨테이너 정리는 수동)를 RUN.md 6절에 안내한다. `TestcontainersConfiguration`의 static 초기화는 컨테이너 기동 실패를 원인 포함 메시지로 재던지고(`ContainerLaunchException`이 `NoClassDefFoundError`에 묻히는 문제 완화), Ryuk이 없는 로컬 환경을 위해 JVM shutdown hook에서 `stop()`도 호출해 잔존 컨테이너를 줄인다.
5. **격리 증명 테스트.** `TestcontainersIsolationTest`(`support` 패키지)가 스프링이 실제로 주입한 datasource URL의 포트·Redis `LettuceConnectionFactory`의 포트를 읽어 (a) 컨테이너의 실제 매핑 포트와 정확히 일치하고 (b) 고정 포트(5432/6379)가 아님을 단언한다. `@ServiceConnection` 매칭이 실패해 고정 포트로 조용히 폴백해도, 상시 로컬/CI 인프라가 떠 있으면 나머지 267개 테스트는 통과해 버려 격리 여부를 증명하지 못한다 — 이 테스트가 그 빈틈을 메운다.

## 근거
- **랜덤 포트 = 상시 스택과 무충돌.** EC2에 이미 떠 있는 liveclass 스택(5432/6379)과 별개로 테스트 전용 컨테이너가 임의 포트에 뜨므로 포트 예약·정리 로직이 필요 없다.
- **싱글턴 + 자동 주입 = 테스트 파일 무변경.** 39개 `@SpringBootTest` 클래스가 이미 존재하고, 개별 수정은 리뷰 범위를 그 파일 수만큼 불필요하게 키운다. `ContextCustomizerFactory`는 스프링 테스트 프레임워크가 컨텍스트 캐시 키 계산에 참여시키는 공식 확장점이라, 전 테스트가 같은 커스터마이저(같은 싱글턴 컨테이너)를 공유하면서 컨텍스트 캐시도 갈라지지 않는다.
- **컨테이너 안에서 빌드 = 러너 환경 독립.** shell executor 러너 호스트에 Java 21/Node 22가 실제로 있는지 가정하지 않는다. DooD로 Testcontainers를 쓰면 "테스트 실행 도구"와 "테스트가 띄우는 인프라" 둘 다 컨테이너로 격리된다.
- **동일 경로 마운트가 DooD의 핵심 제약.** Testcontainers/Ryuk이 만드는 형제 컨테이너의 바인드 마운트는 호스트 데몬이 해석하므로, outer 컨테이너 안의 마운트 경로 문자열이 호스트에서도 유효해야 한다(공식 문서가 명시).

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| (선택) Testcontainers + 컨테이너 안에서 gradle/npm 실행 | 러너 호스트 환경 가정 없음, 상시 스택과 포트 무충돌, 로컬 개발도 compose 불필요 | DooD 설정(동일 경로 마운트) 이해 필요, 컨테이너 시작 오버헤드 |
| 러너 호스트에 Java 21/Node 직접 설치 후 네이티브 실행 | 컨테이너 오버헤드 없음 | 러너 프로비저닝이 코드 밖 수동 작업이 됨, 재현성 낮음 |
| CI에서 `docker-compose.dev-infra.yml`을 고정 포트로 띄워 테스트 | 컨테이너 격리 불필요 | 상시 dev-infra 스택과 포트 충돌(5433/6380이라도 동시 MR 파이프라인이 겹치면 충돌), 정리 로직 필요 |
| 테스트를 계속 로컬 전용으로 두고 CI는 빌드만 검증 | 변경 없음 | 계약 테스트가 CI 게이트 역할을 못함(현재 문제 그대로) |

## 영향·후속
- **의존성 추가**: `backend/build.gradle`에 `spring-boot-testcontainers`·`testcontainers-junit-jupiter`·`testcontainers-postgresql`(testImplementation). 버전은 Boot 4.1 BOM 관리 — `./gradlew dependencies --configuration testRuntimeClasspath | grep testcontainers`로 확인하면 전부 `2.0.5`(Testcontainers 2.x)로 해석된다.
- **신규 파일**: `backend/src/test/java/com/liveclass/support/TestcontainersConfiguration.java`, `TestcontainersContextCustomizerFactory.java`, `TestcontainersIsolationTest.java`, `backend/src/test/resources/META-INF/spring.factories`.
- **`.gitlab-ci.yml`**: `stages`에 `test` 추가, `test-backend`(`resource_group: backend-test`, `changes: backend/**/*`+`.gitlab-ci.yml`)·`test-frontend`(`changes: frontend/**/*`+`.gitlab-ci.yml`, `node_modules` 전용 named volume) job 추가. `build`/`deploy`류는 무변경.
- **문서**: `LiveClassApplicationTests`의 클래스 주석, `RUN.md` 6절(테스트) 안내 갱신(Testcontainers 기반, Colima 로컬 워크어라운드 포함) — 7절 트러블슈팅에서 6절을 상호참조.
- **검증**: 로컬 `./gradlew test`(컨테이너 사용 로그·격리 증명 테스트 포트값으로 확인) + 로컬에서 CI와 동일한 `docker run` 명령 실행, 둘 다 269개 테스트(267 기존 + 격리 증명 2개) 통과.
- **운영 메모**:
  - gradle-cache/frontend-node-modules named volume은 root 사용자 전제(컨테이너가 기본 root로 실행되어 `/var/run/docker.sock`·`/root/.gradle`·`/app/node_modules`에 쓸 수 있음) — 러너 docker 실행 사용자가 바뀌면 재검토 필요.
  - 러너에 컨테이너가 누적되지 않도록(특히 Ryuk 없이 도는 로컬/이상 종료 경로) `docker container prune --filter label=org.testcontainers=true`를 주기 실행하는 것을 권고(cron 설정 자체는 범위 밖).
- **후속 미결정**: Ryuk이 매 파이프라인 실행마다 컨테이너를 새로 만들므로 이미지 pull 시간이 반복 실행 시간에 영향을 준다 — 필요해지면 러너 호스트에 이미지 pre-pull이나 별도 캐시 전략을 고려한다(현재는 범위 밖).
