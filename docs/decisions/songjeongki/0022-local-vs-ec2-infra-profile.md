# ADR-0022: 로컬↔EC2 인프라 전환 = Spring 프로필(remote) + EC2 포트 공개(expose)

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-21
- **관련**: [0008](0008-ai-bus-redis-streams-session-clock.md)(AI 버스=Redis Streams), [0011](0011-ai-three-services.md)(realtime-agent), [0013](0013-unified-streaming-stt.md)(스트리밍 STT), [0004](0004-media-livekit-selfhost.md)(LiveKit), [0015](0015-docker-deploy-fe-be-nginx.md)(배포), 계약 [../../CONTRACT.md](../../CONTRACT.md) §3-3

## 맥락
- 라이브 STT 파이프라인: `realtime-agent`(Python, LiveKit Agent)가 강사 오디오를 구독→스트리밍 STT→**Redis Streams**에 `caption.*` 푸시. Spring이 **consumer group**으로 소비→PG 영속+WS 전달 ([0008]/[0011]/[0013], [CONTRACT §3-3](../../CONTRACT.md)).
- 그런데 `realtime-agent`·LiveKit 미디어 스택은 **EC2에만** 있다(로컬 미디어는 제한적). 즉 STT는 **EC2의 Redis 스트림**에만 쌓인다.
- 반면 로컬 개발 백엔드는 `application.yml`의 `localhost` 하드코딩으로 **로컬 도커 Redis**를 본다 → 스트림이 비어 있어 STT consumer/WS/영속 로직을 개발할 수 없다.
- prod(`docker-compose.prod.yml`)는 Redis/PG 호스트 포트를 **미노출**(내부 네트워크 전용) + ufw/SG 2계층 방화벽으로 잠가 둔다.

## 결정
1. **한 스위치로 전부 로컬 ↔ 전부 EC2.** 컴포넌트별 개별 토글을 두지 않는다. `SPRING_PROFILES_ACTIVE`(미지정=로컬, `remote`=EC2) 하나가 datasource·Redis를 통째로 바꾼다.
   - 기본(no-profile) = `application.yml`의 `localhost`(로컬 도커).
   - `remote` = `application-remote.yml`이 datasource·Redis를 EC2 호스트로 override.
2. **LiveKit은 양쪽 모두 EC2 고정.** 로컬 미디어 스택은 제한적이므로 프로필과 무관하게 항상 원격(`application.yml`의 `livekit.url` 기본값 `wss://jiphyeonjeon.thdwjdrl.com` 유지). "전부 로컬" 프로필도 LiveKit만은 EC2다.
3. **EC2 접속 경로 = 포트 직접 공개**(SSH 터널 아님). 서버 측 별도 compose override `docker-compose.expose.yml`이 prod 위에 겹쳐 5432/6379를 공개한다.
   - Redis는 공개와 동시에 **`requirepass` 필수**(`EC2_REDIS_PASSWORD`). 같은 스택의 prod 백엔드도 이 비밀번호를 주입받아 붙는다.
   - **2계층 방화벽으로 소스 제한**: AWS SG 인바운드 5432/6379 → 팀 공인 IP만, EC2 ufw로도 소스 IP 제한. 공개 인터넷 노출 금지.
4. **remote 프로필은 EC2 스키마를 마이그레이션하지 않는다.** `spring.flyway.enabled=false`. 공유 EC2 스키마는 배포 파이프라인이 소유 — 개발자 노트북이 건드리지 않는다. `ddl-auto=validate`는 유지해, EC2 스키마가 뒤처지면 실패로 드러난다(재배포 신호).
5. **시크릿 분리.** dev 측은 `.env.remote`(git 무시, `.env.remote.example` 커밋), EC2 측은 `.env.prod`에 `EC2_REDIS_PASSWORD` 추가.

## 근거
- **왜 프로필 한 스위치**: STT는 Redis에만 있지만, 컴포넌트별 env 토글(REDIS_TARGET/PG_TARGET 조합)은 설정 표면이 넓고 "Redis만 원격+PG 로컬" 같은 반쪽 상태에서 세션/영속 불일치 실수가 나기 쉽다. 하나의 일관된 상태(전부 로컬 / 전부 EC2)가 예측 가능하다.
- **왜 포트 직접 공개(팀 선택)**: SSH 터널보다 접속이 단순하고, 서버 측 run 프로필로 on/off를 명시적으로 관리한다. 대신 노출 리스크를 requirepass + SG/ufw 소스 제한으로 상쇄한다.
- **왜 prod은 그대로 env override**: 프로필 파일보다 우선순위가 높은 env(`SPRING_DATASOURCE_URL` 등)를 이미 쓰므로, 프로필 도입이 prod 동작을 바꾸지 않는다(회귀 없음).

## 유보(Deferred, CP2 — STT consumer 착수 시)
- **Consumer group 오염 방지.** 로컬 백엔드가 EC2 Redis 스트림에 **EC2 백엔드와 같은 consumer group**으로 붙으면 그룹 내 분배로 서로 메시지를 뺏는다(리플레이해도 한 번씩만). STT 소비 코드를 만들 때 **consumer group 이름에 인스턴스/개발자 식별자**를 넣어 개발자마다 독립 그룹으로 붙게 한다. 아직 소비 코드가 없어 지금은 문서 규약으로만 남긴다.
- **세션 저장소 공유.** remote일 때 세션도 EC2 Redis(`liveclass:session`)에 저장돼 EC2 백엔드와 공유된다. 개발 편의상 허용하되, 격리가 필요하면 namespace 분리를 검토.

## 영향·후속
- **신규/변경 파일**: `backend/src/main/resources/application-remote.yml`, `docker-compose.expose.yml`, `.env.remote.example`, `.env.prod.example`(EC2_REDIS_PASSWORD), `.vscode/launch.json`(EC2 infra 런치/컴파운드), `package.json`(`dev:remote:wsl`), `RUN.md`(원격 인프라 실행 절), `.gitignore`(`.env.remote`).
- **실행법**: [RUN.md](../../../RUN.md) "EC2 인프라에 붙어 실행" 절 참고. VSCode는 `Spring Boot (Backend · EC2 infra)` 런치, 터미널은 `npm run dev:remote:wsl`.
- **계약 테스트**: 인프라 구성 변경(런타임 로직 아님)이라 계약 테스트 대상 아님 — [POLICY](../../harness/POLICY.md) 기준 부하 없음. STT consumer(CP2) 착수 시 소비 계약 테스트를 별도로 건다.
