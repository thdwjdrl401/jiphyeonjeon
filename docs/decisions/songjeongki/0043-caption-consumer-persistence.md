# ADR-0043: 라이브 자막 소비 파이프라인 — Spring consumer·영속·WS 전달

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택 (BE 구현)
- **일자**: 2026-07-29
- **관련**: [0040](0040-caption-delta-contract.md)(델타 계약), [canola/0022](../canola/0022-realtime-caption-stream-retention.md)(producer MAXLEN), [0038](0038-ci-test-gate-testcontainers.md)(Testcontainers), CONTRACT §3-4·§3-6, [ADR-0019](0019-ws-realtime-chat-stomp.md)(채팅 WS 구독 인가·와일드카드 차단 불변식)
- **오너 경계**: BE(송정기) — 소비·영속·WS 중계·구독 인가 / AI(유채은·박진우) — agent 발행(구현·배포 완료) / FE(윤광혁·서민경) — 자막 렌더

## 맥락

realtime-agent가 application Redis Stream 전역 키 `ai:captions:live`에 `caption.delta`·`caption.stream.completed`를 `XADD`하는 것까지는 구현·배포·검증됐다(§3-4, canola MR). 그 이후 **Spring의 소비 → PG 영속 → 학생 WebSocket 전달이 전부 미구현**이었다. 와이어 정본은 `ai/realtime-agent/contracts/schemas/caption-stream-entry.schema.json`과 fixture 2건이며, ai-api는 이미 group `ai-rag-live-v1`로 같은 스트림을 소비한다.

계약상 확정 사실(재확인): 이벤트는 **2종만**(`segment.final`·`partial/final/revised`는 존재하지 않음), 전달보장 at-least-once, producer가 `MAXLEN ~` 근사 트리밍, 멱등키는 `eventId`(sequence는 retry마다 1부터 재시작하므로 UNIQUE 금지), attempt 범위는 `(sessionId, sttSessionId)`, `streamElapsedMs`는 agent 첫 오디오 프레임=0 기준 attempt-local ms다.

## 결정

### 1. 소비 — 별도 consumer group, 프로필 구동 Redis

- ai-api가 `ai-rag-live-v1`로 소비 중이므로 Spring은 **반드시 별도 group `spring-caption-live-v1`**로 소비한다(Redis consumer group은 서로 독립적으로 전체 메시지를 받는다). 같은 group을 쓰면 두 소비자가 서로 메시지를 뺏는다.
- `StreamMessageListenerContainer`(Spring Data Redis/Lettuce)로 기존 자동설정 `RedisConnectionFactory`를 재사용한다. 소비 대상 Redis는 별도 설정이 아니라 **`spring.data.redis`가 가리키는 프로필 구동 Redis**다(로컬=localhost, **remote 프로필=EC2 :4000 application Redis** — GPU realtime-agent가 실제로 캡션을 XADD하는 곳). 이로써 로컬 backend를 remote로 띄우면 실제 캡션 스트림을 소비해 개발/검증할 수 있다.
- 등록은 `StreamReadRequest`를 직접 만들어 하고 **`cancelOnError(t -> false)`**로 오류에도 구독을 유지한다(→ [보강 노트](#보강-노트-2026-07-30--일시-오류-복원력구독-유지)). Spring Data Redis 기본값은 "오류 시 구독 취소"라서 그대로 두면 일시적 연결 오류 하나로 소비가 영구 정지한다.
- 부팅 시 group 생성(`BUSYGROUP` 무시, `MKSTREAM`) + 이 consumer의 pending을 `XREADGROUP id 0`으로 drain한다(안정 consumer 이름 전제). 처리는 **수동 ACK** — 필드 파싱 → type 분기 → 멱등 저장 → **엔트리별 XACK**. 파싱 불가(poison)는 로그 후 **ACK 폐기**(재시도해도 같은 결과), 일시적 저장 실패는 ACK하지 않아 pending에 남기고 재소비한다. 참조 구현 `ai/ai-api/app/adapters/redis_caption_consumer.py`와 대칭이다.
- dev 인프라를 여러 개발자가 공유할 때를 위해 group 접미사(`liveclass.caption.group-instance-suffix`, remote 기본 `dev`)로 group을 분리한다(`application-remote.yml` 경고 반영).

### 2. 영속 — append-only, eventId 멱등

- `caption.delta`를 **전부** `core.live_caption`에 append-only 저장 + WS 전달한다. `caption.stream.completed`도 스트림 종료 마커로 영속한다.
- **멱등키는 `eventId` 하나**만 UNIQUE다. `existsByEventId` fast-path + `saveAndFlush`의 `DataIntegrityViolationException` 흡수로 경합을 처리한다(`AiCallbackService`·`ChatService`와 동일 패턴). 실제로 저장된 경우에만 `@TransactionalEventListener(AFTER_COMMIT)`로 WS 전달한다(멱등 중복은 발행 안 함 → 자연 제외).
- 스키마는 Flyway 마이그레이션이 소유한다. session_id·lesson_id에 **FK를 걸지 않는다** — 외부(AI) 스트림의 raw ingest 로그라 core 세션 행 존재 여부와 무관하게 at-least-once write를 흡수해야 한다.

### 3. 시간축 — raw ms only (계약 강제)

- 루트 CONTRACT §3-4가 "변환 전 raw `streamElapsedMs`를 세션 상대 ms로 영속·중계하지 않는다"고 명시한다. 따라서 **`stream_elapsed_ms` raw만 저장**하고 `session_ms` 컬럼을 두지 않으며, **WS payload도 raw `streamElapsedMs` 그대로** 전달한다. session-relative ms 변환·앵커, session별 키 전환, HLS 정합은 후속 공유 계약(ADR-0040 보강안)이다.

### 4. WS 전달·구독 인가 — 와일드카드 차단 불변식 유지

- 저장 성공분을 STOMP `/topic/live-sessions/{sessionId}/captions`에 `WsEnvelope.of(type, sessionId, occurredAt, payload)`로 전달한다(`WsChatBroadcaster`와 동형). payload는 camelCase — delta `{sttSessionId, sequence, streamElapsedMs, text}`, completed `{sttSessionId, lastSequence, reason}`.
- 채팅 구독 인터셉터(`ChatTopicSubscriptionInterceptor`)는 ADR-0019 불변식으로 `/topic/live-sessions/{id}/chat` **정확 매칭만** 허용하고 그 외 `/topic` 구독(와일드카드 포함)을 전부 거부한다. 자막 토픽도 **`LiveAccessGuard.requireCanAccess`로 게이트한 정확 매칭 허용을 추가**하되, 와일드카드 차단 불변식은 그대로 유지한다(임의 세션 자막 도청 구멍 금지). 계약 테스트로 고정한다.

## 보강 노트 (2026-07-30) — 일시 오류 복원력(구독 유지)

> 새 ADR을 만들지 않고 여기에 보강한다: 결정 대상이 위 **§1 소비**가 배선한 바로 그 컨테이너이고, 수동 ACK·at-least-once·pending 전제를 그대로 유지한 채 "오류 시 구독 취소" 기본값만 뒤집는 교정이다. 대안 비교가 필요한 새 아키텍처 선택이 아니라 §1의 누락 보완이므로 소비 정책을 한 문서에 모으는 편이 읽기·검색에 유리하다.

### 관측된 장애 (prod 포함)

로컬 BE(remote 프로필, EC2 dev redis :4000 소비) 실행 중 네트워크가 순간 끊겨 `RedisConnectionFailureException: Unable to connect`(→ `AnnotatedSocketException: Network is unreachable`)가 **딱 1회** 찍힌 뒤, **네트워크가 복구돼도 소비가 재개되지 않았다**. Redis 그룹 상태: `spring-caption-live-v1-dev`는 `lag=92, pending=0`에서 고정(새 엔트리를 읽지 않음), 같은 스트림의 `ai-rag-live-v1`(ai-api)은 `lag=0` — 스트림·네트워크는 정상이고 **우리 consumer만 죽은 상태**.

### 원인

`StreamMessageListenerContainer.receive(consumer, offset, listener)`는 `StreamReadRequestBuilder`의 기본값 **`cancelSubscriptionOnError = t -> true`**로 구독을 등록한다(spring-data-redis 4.1.0, `StreamMessageListenerContainer.java:345`, `receive(...)`는 `:203`). `StreamPollTask.doLoop()`(`:135-141`)는 poll 예외마다 이 술어를 **먼저** 평가해 참이면 `cancel()`하고 **그 다음에** errorHandler를 호출한다. 즉 `.errorHandler(...)`를 줘도 **로깅만 하고 구독은 이미 취소**돼, 일시 오류 하나로 poll 루프가 끝나고 재기동 전까지 복구되지 않는다. Lettuce는 자동 재연결하므로 **컨테이너만 죽지 않으면** 다음 poll부터 스스로 복구된다.

### 결정

- 등록을 `StreamReadRequest` 직접 구성으로 바꾼다 — **`cancelOnError(t -> false)`** + **`autoAcknowledge(false)`**(수동 ACK 유지) + 요청 단위 `errorHandler`. 오류는 pending을 남긴 채 다음 poll로 넘어가며 at-least-once 의미는 그대로다.
- **로그 폭주 방지**: 장애 에피소드의 **첫 오류는 항상 ERROR**, 계속 실패하는 동안은 **30초마다** 누적 횟수를 담아 ERROR로 요약(그 사이는 debug). 마지막 오류로부터 60초가 지나면 새 에피소드로 보고 다시 즉시 ERROR. **삼키지 않는다** — 장애는 반드시 ERROR로 드러난다.
- **재시도 백오프**: 연결이 죽은 동안 blocking XREADGROUP은 블로킹 없이 즉시 실패하므로, 연결·타임아웃 계열(`DataAccessResourceFailureException`·`QueryTimeoutException`·원인 사슬의 `IOException`)에만 **1초** sleep을 넣어 busy loop를 막는다. listener 처리 오류(DB 일시 장애 등)는 엔트리 단위로 진행되어 폭주하지 않으므로 지연을 넣지 않는다.
- 정상 종료 잡음 처리는 유지한다 — `!running`이거나 원인 사슬에 `CancellationException`이면 debug.

### 회귀 테스트

- `LiveCaptionStreamResilienceTest`(Testcontainers Redis+PG): consumer만 **in-JVM TCP 프록시**를 통해 Redis에 붙인 뒤 프록시를 끊고(리스닝 소켓 close + 열린 연결 강제 종료) 다시 같은 포트로 되살린다 → **재기동 없이** 새 엔트리가 소비되고 pending이 0으로 수렴함을 검증하고, 끊김 동안 ERROR 로그가 남는지(삼키지 않음)도 함께 고정한다. 싱글턴 Redis 컨테이너를 pause/stop하면 스위트 전체가 흔들리므로 프록시 방식을 택했다.
- `CaptionStreamConsumerReadRequestTest`(Redis 없음): 등록 요청의 `cancelSubscriptionOnError`가 `false`, `autoAcknowledge`가 `false`, offset이 `">"`임을 고정한다 — `receive(...)`로 되돌리면 즉시 깨진다.
- 두 테스트 모두 수정 전 코드에서 **실패**함을 확인했다(회귀 검출력 확인).

### 남은 위험

- **복구 지연**: 연결이 끊기면 이미 나간 XREADGROUP이 재연결을 기다리며 매달린다. `spring.data.redis.timeout`이 없으면 Lettuce 기본 command timeout(60초)까지 poll 스레드가 묶여 그만큼 복구가 늦다. 자막 지연 요구가 빡빡해지면 `spring.data.redis.timeout`을 낮추는 별도 결정이 필요하다(전역 영향이라 이번 범위 밖).
- **pending 누적**: 장애 중 producer가 계속 XADD하면 lag이 쌓이고, 복구 후 배치로 몰려 소비된다. producer의 `MAXLEN ~` 근사 트리밍(canola/0022)이 상한이므로 장애가 트리밍 윈도우보다 길면 그 구간 자막은 유실된다(at-least-once의 한계, 계약대로).
- 감시 지표(consumer lag alert)는 아직 없다 — 현재는 ERROR 로그가 유일한 신호다.

## 범위 밖 (명시적 제외)

- realtime-agent→Spring **lifecycle HTTP callback**(§3-5, `SPRING_STATUS_CALLBACK_ENABLED=false`): 별도 endpoint, 기본 off, material callback과 서명·body 비호환. 이번 범위 아님. 스트림 종료는 in-band `caption.stream.completed`로만 처리한다.
- 시간축 session-ms 변환, session별 키 전환, HLS 정합 — 후속 공유 계약.

## 의존성 후속 상태

- **prod 캡션-Redis 토폴로지 — 2026-07-30 해소**: [canola ADR-0035](../canola/0035-realtime-agent-dual-environment-runtime.md)에서 prod agent를 prod Redis의 GPU tunnel `:6390`, dev agent를 dev Redis tunnel `:4000`에 각각 연결했다. Spring consumer도 자기 환경의 같은 Redis instance를 사용하므로 caption stream이 환경을 넘지 않는다.

## 계약 테스트 (POLICY: Python↔Spring 스트림 필드 계약 + 자막 전달 핵심경로)

Testcontainers(Redis+PG, ADR-0038)로 두 벌을 고정한다. fixture는 `ai/realtime-agent/contracts/fixtures/*.valid.json`을 그대로 사용해 양측 정합을 잠근다.

- **소비/영속/ACK**(`LiveCaptionStreamContractTest`): 스키마 fixture XADD → 소비 → PG 저장·ACK(pending 0), 중복 eventId 1행, poison 폐기+ACK.
- **WS 봉투·구독 인가**(`LiveCaptionWebSocketTest`): 봉투 형태·목적지, delta payload 필드(raw `streamElapsedMs`), 비참가자 captions SUBSCRIBE 거부.

배경 consumer가 싱글턴 Testcontainers Redis를 여러 컨텍스트와 공유해 교차 오염하지 않도록, 자막 consumer는 테스트에서 기본 off이고 두 계약 테스트만 **격리된 stream-key/group**으로 재활성화한다.

## 조율 필요 (병렬 미머지 브랜치)

- **마이그레이션 버전**: origin/master 최신은 V7이나 **커리큘럼 자료 브랜치가 V8을 예약**했으므로 이 구현은 **V9**(`V9__live_caption.sql`)을 쓴다.
- **ADR 번호**: songjeongki 최신은 0041이나 **0042는 커리큘럼 브랜치가 예약**했으므로 이 문서는 **0043**을 쓴다.
- 두 브랜치가 머지되며 V/ADR 번호가 충돌하면 재넘버링이 필요할 수 있다(MR 설명에 명시).

## 변경 파일

- 마이그레이션 `backend/.../db/migration/V9__live_caption.sql`, 엔티티 `LiveCaption`, 리포 `LiveCaptionRepository`, 서비스 `LiveCaptionService`.
- 스트림 소비: `CaptionStreamProperties`·`CaptionStreamConsumer`(config), `CaptionEvent`·`CaptionEventParser`·`CaptionParseException`·`CaptionStreamListener`(service).
- WS: `LiveCaptionStoredEvent`, `WsCaptionBroadcaster`, `CaptionDeltaPayload`·`CaptionCompletedPayload`, `ChatTopicSubscriptionInterceptor`(자막 토픽 허용 추가).
- 설정: `application.yml`(`liveclass.caption.*`)·`application-remote.yml`(group 접미사).
- 계약 갱신: CONTRACT §3-4·§3-6, ai/CONTRACT §4.6·§7.
