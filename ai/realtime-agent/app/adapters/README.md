# External adapters

## 역할

application Redis와 Spring HTTP callback처럼 프로세스 밖 시스템에 연결하는 outbound adapter를 둔다.

## 구조와 흐름

자막 파이프라인은 `RedisCaptionPublisher`를 await해 Redis Stream에 기록한다. room job은 session lease를
획득·갱신·해제하며, callback이 설정된 경우 생명주기 상태를 HMAC 서명한 HTTP 요청으로 전송한다.

## 파일 구성

- `redis_caption_publisher.py`: `ai:captions:live` Stream에 delta·completed 이벤트를
  `XADD MAXLEN ~`로 제한 발행
- `redis_session_lease.py`: `SET NX EX` 및 owner 비교 Lua로 중복 job 방지
- `spring_status_callback.py`: 상태 payload 직렬화, 서명, 제한된 재시도

## 경계와 불변식

Redis 자막 entry는 다음 camelCase 필드를 사용한다.

- delta: `contractVersion`, `eventId`, `type=caption.delta`, `sessionId`, `lessonId`,
  `sttSessionId`, `sequence`, `streamElapsedMs`, `text`, `occurredAt`
- completed: 위 식별 필드와 `type=caption.stream.completed`, `lastSequence`,
  `reason=ROOM_DELETED`, `occurredAt`

Spring callback body는 `contractVersion`, `eventId`, `eventType=LIVE_AGENT_STATUS`, `sessionId`,
`lessonId`, `jobId`, `state`, `occurredAt`과 실패 시 `error`를 담는다. 요청 헤더는
`Idempotency-Key`, `X-Correlation-Id`, `X-LiveClass-Timestamp`, `X-LiveClass-Signature`이며,
서명은 `v1=hex(HMAC-SHA256(secret, timestamp + "." + rawBody))`다. 재시도는 같은 body·event ID·timestamp·서명을
재사용한다. 이 형식은 아직 Java가 채택하지 않은 AI-side v1 후보 계약이다.

## 검증

`tests/test_redis_caption_publisher.py`, `tests/test_redis_session_lease.py`,
`tests/test_spring_status_callback.py`에서 wire shape, timeout, retry, 소유권을 검증한다.
