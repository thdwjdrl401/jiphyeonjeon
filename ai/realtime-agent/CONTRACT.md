# realtime-agent AI-side v1 proposal

이 문서는 realtime-agent가 생성·소비할 메시지를 Python 테스트로 고정하기 위한 **AI-side 제안
계약**이다. 현재 Java `master`와 `docs/CONTRACT.md`가 채택한 공유 계약이 아니며, Java 연동 완료를
의미하지 않는다.

현재 Java에는 named LiveKit AgentDispatch 생성, 아래 Redis stream consumer, live-agent callback
handler가 없다. 특히 공유 문서의 `caption.partial|final|revised`와 이 문서의 append-only
`caption.delta|caption.stream.completed`는 이벤트 이름과 시간축이 다르다. Java가 채택할 때 양측
코드·fixture와 `docs/CONTRACT.md`를 같은 common MR에서 갱신해야 한다.

## 1. Spring → LiveKit → realtime-agent dispatch metadata

LiveKit job metadata는 UTF-8 JSON object이며 최대 4,096 byte다. 필드는 정확히 아래 네 개만
허용하고 duplicate key도 거부한다.

```json
{
  "contractVersion": "1",
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "lessonId": "22222222-2222-4222-8222-222222222222",
  "correlationId": "live-start-01"
}
```

- `sessionId`, `lessonId`: 소문자 canonical UUID 문자열
- `correlationId`: `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`
- assigned room과 connected room: 모두 정확히 `session-{sessionId}`
- `instructorIdentity`: 포함하지 않는다. 현재 방 권한 불변식상 유일한 remote microphone
  publisher만 선택하고 두 번째 publisher는 fail-closed 처리한다.

metadata와 assigned room 검증은 Redis lease, LiveKit connect, audio source, STT engine보다 먼저
실행한다.

## 2. realtime-agent → application Redis caption stream

- Redis URL: `REDIS_URL`로 주입한다. LiveKit 내부 Redis나 host `6380`을 전제로 하지 않는다.
- stream key: `CAPTION_STREAM_KEY`, 기본값 `ai:captions:live`
- write: 각 `XADD`를 직접 await하고 제한 시간 안에 응답하지 않거나 실패하면 job을 실패시킨다.
- retention: 모든 `XADD`에 `MAXLEN ~ CAPTION_STREAM_MAXLEN`을 적용하며 기본값은 10,000 엔트리다.
  값은 양의 정수만 허용해 무제한 누적 설정을 막는다. 근사 trimming이므로 실제 길이는 일시적으로
  기준보다 조금 클 수 있고, 이는 바이트 상한이나 Redis 전체 `maxmemory` 설정이 아니다.
- 모든 정수 필드: 부호 없는 최대 18자리 십진 문자열

`caption.delta` fields:

```json
{
  "contractVersion": "1",
  "eventId": "33333333-3333-4333-8333-333333333333",
  "type": "caption.delta",
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "lessonId": "22222222-2222-4222-8222-222222222222",
  "sttSessionId": "provider-session-01",
  "sequence": "1",
  "streamElapsedMs": "1200",
  "text": "안녕하세요",
  "occurredAt": "2026-07-27T00:00:01.200Z"
}
```

`caption.stream.completed` fields:

```json
{
  "contractVersion": "1",
  "eventId": "44444444-4444-4444-8444-444444444444",
  "type": "caption.stream.completed",
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "lessonId": "22222222-2222-4222-8222-222222222222",
  "sttSessionId": "provider-session-01",
  "lastSequence": "1",
  "streamElapsedMs": "1200",
  "reason": "ROOM_DELETED",
  "occurredAt": "2026-07-27T00:00:02.000Z"
}
```

`sequence`와 `lastSequence`의 범위는 `(sessionId, sttSessionId)`로 식별되는 **한 job attempt의
STT stream**이다. 각 attempt는 `sequence=1`부터 시작할 수 있으므로 consumer는 `sessionId`만으로
sequence를 합치면 안 된다. completion에도 같은 `sttSessionId`를 넣어 어느 attempt를 닫는지
명시한다. sequence는 publish 성공 뒤에만 commit한다. 빈 문자열 delta는 거부하지만 STT가 생성한
공백 문자열은 바꾸거나 trim하지 않는다. `streamElapsedMs`는 Spring session clock이 아니라
realtime-agent가 받은 첫 audio frame을 0으로 보는 stream-local clock이다. session-relative 자막에
사용하려면 Java와 time-origin 변환 계약을 먼저 합의해야 한다.

completion은 LiveKit `ROOM_DELETED`를 명시적으로 받아 남은 audio와 engine event를 정상 drain한
뒤에만 새로 발행을 시도한다. 다른 disconnect, cancellation, lease loss, provider 오류에서는 새
completion 발행을 시작하지 않는다.

Redis write는 at-least-once 전달 경계다. client timeout이나 lease loss가 in-flight `XADD`와
경쟁하면 Redis commit 뒤 응답만 잃었을 수 있으므로 결과는 **unknown**이다. producer cancellation은
"절대 기록되지 않았다"는 보장이 아니다. consumer는 `eventId`로 중복을 제거하고,
`(sessionId, sttSessionId)` attempt 단위로 상태를 접어야 한다. 이 ambiguity를 제거하려면 Java 채택
MR에서 owner fencing과 idempotency record를 같은 Redis 원자 연산으로 합의해야 한다.

completion `XADD`를 시작한 시점부터 remote 결과는 성공 또는 unknown인 terminal 구간이다. 이
구간에서는 `FAILED` callback을 새로 만들지 않는다. 성공 응답을 받으면 해당 attempt의 확정적인
point-of-no-return이며, 그 뒤 `SUCCEEDED` callback 구간에서 cancellation이나 lease loss가 발생하면
callback이 누락될 수는 있어도 이미 닫힌 caption stream을 반대 terminal로 뒤집지 않는다.

## 3. realtime-agent → Spring lifecycle callback

기본값은 `SPRING_STATUS_CALLBACK_ENABLED=false`다. Java가 이 제안 계약을 채택하기 전에는 켜지
않는다. 활성화하려면 HTTP(S) callback URL과 최소 32 byte secret을 모두 주입해야 한다. 운영
네트워크에서는 HTTPS를 사용한다.

요청 body는 compact UTF-8 JSON이며 다음 필드를 사용한다.

```json
{
  "contractVersion": "1",
  "eventId": "55555555-5555-4555-8555-555555555555",
  "eventType": "LIVE_AGENT_STATUS",
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "lessonId": "22222222-2222-4222-8222-222222222222",
  "jobId": "livekit-job-01",
  "state": "STT_STARTED",
  "occurredAt": "2026-07-27T00:00:00.500Z"
}
```

상태는 `ROOM_CONNECTED`, `STT_STARTED`, `AUDIO_STARTED`, `STOPPING`, `SUCCEEDED`, `FAILED`다.
`FAILED`만 `{code,message,retryable}` 형태의 `error`를 필수로 가지며 다른 상태에는 error를 넣지
않는다.

요청 headers:

- `Idempotency-Key: {eventId}`
- `X-Correlation-Id: {dispatch correlationId}`
- `X-LiveClass-Timestamp: {Unix seconds}`
- `X-LiveClass-Signature: v1={lowercase hex HMAC-SHA256}`

서명 입력은 `ASCII(timestamp) + "." + rawBody`다. 한 report의 bounded retry는 event ID,
timestamp, raw body와 signature를 전부 동일하게 재사용한다. terminal 상태를 준비한 뒤 반대
terminal 상태를 새 event로 만들지 않는다. nonterminal callback은 작은 시간 budget 안의
best-effort라 STT/audio loop를 장시간 막지 않고, terminal callback 오류는 호출자에게 전파한다.
HTTP timeout도 server가 처리한 뒤 응답만 유실된 상태일 수 있으므로 consumer는 `Idempotency-Key`를
멱등하게 처리해야 한다.

현재 Java의 material callback URL·DTO·base64 `X-Signature`와 호환되지 않는다. 운영 URL은 코드에
고정하지 않고 `SPRING_STATUS_CALLBACK_URL`로만 받는다.

## 4. session lease와 종료

내부 lease key는 `agent:session:{sessionId}`이며 value는 LiveKit job ID다. `SET NX EX`로 획득하고
Lua compare-and-expire/delete로 owner만 갱신·해제한다. lease를 얻지 못하면 audio source와 STT
engine을 시작하지 않는다. **lease를 얻지 못한 중복 job은 lifecycle callback도 발행하지 않는다.**
active owner와 같은 `sessionId`를 가진 거절 job이 `FAILED`를 보내 현재 세션 상태를 덮는 일을 막기
위함이다. acquire·renew·release Redis 연산은 bounded timeout을 사용한다. 실행 중 ownership 상실이나
renewal timeout은 owner job 실패이며 감지 뒤 신규 caption publish를 시작하지 않는다. 이미 in-flight인
Redis write 결과는 위 at-least-once 규칙에 따라 unknown일 수 있다.

LiveKit Agents 1.6.6은 room disconnect 뒤 약 15초가 지나면 user entrypoint를 취소한다. 따라서
`ROOM_DELETED` 수신 순간부터 기본 12초(설정 상한 13초)의 하나의 absolute deadline을 시작하고,
audio/event drain, engine/source cleanup, completion write, terminal callback, lease/report cleanup이 모두
그 남은 budget을 공유한다. 개별 timeout을 단순 합산해 SDK의 15초를 넘기지 않는다.

별도 Python stop HTTP API나 Redis stop command는 두지 않는다. 정상 종료 입력은 Spring이 이미
수행하는 LiveKit room 삭제이며, Python은 `ROOM_DELETED`만 정상 EOF로 분류한다. 다른 disconnect는
실패다.

## 5. Java 채택 전 필수 gate

1. Spring이 `captionEnabled` session에 같은 agent name으로 explicit dispatch를 만든다.
2. 이 metadata schema/fixture를 Java serializer와 양측 contract test로 검증한다.
3. Redis key, consumer group, 세션 종료 후 정리, event enum, timeout 결과의 멱등/fencing과 session
   clock 변환을 확정한다.
4. callback URL, HMAC 방식, event ID 멱등성과 terminal first-wins 처리를 확정한다.
5. `docs/CONTRACT.md`를 실제 구현과 함께 갱신하고 LiveKit·Redis·Spring E2E를 별도 실행한다.
