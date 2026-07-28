# ADR-0014: realtime-agent 수명주기와 외부 메시지는 AI 제안 계약으로 먼저 고정

- **상태**: 채택
- **일자**: 2026-07-27
- **관련**: [ADR-0009](0009-realtime-agent-core-boundary.md),
  [ADR-0010](0010-realtime-agent-room-job-boundary.md),
  [ADR-0012](0012-realtime-stt-provider-and-overload-boundary.md),
  [ADR-0028](0028-stt-provider-execution-profile-and-warm-pool.md)

## 맥락

분할 전 `feat/ai/mvp-service-scaffold`에는 LiveKit dispatch metadata, Redis caption stream,
session lease, Spring callback, AgentServer 실행 코드가 한 번에 들어 있었다. 그러나 현재 Java
`master`에는 named agent dispatch, caption consumer, live-agent lifecycle callback handler가 없고,
`docs/CONTRACT.md`의 자막 이벤트와 원본 Python 이벤트는 이름과 시간축도 다르다. 원본을 통째로
cherry-pick하면 아직 합의되지 않은 Python 메시지를 공유 계약처럼 확정하거나, 이미 분리해 검증한
audio/STT core를 오래된 구현으로 덮어쓰게 된다.

정상 종료에도 빈틈이 있었다. 기존 audio source는 방 연결이 끊기면 이유와 무관하게 실패했고,
외부에서 정상 EOF를 전달할 경로는 없었다. 반면 현재 Spring은 라이브 종료 때 LiveKit room을
삭제하며, LiveKit SDK는 이를 `ROOM_DELETED`라는 구체적인 종료 사유로 전달한다.

## 결정

이번 `feat/ai/realtime-agent-lifecycle` MR은 다음 경계를 Python 안에서 구현한다.

1. LiveKit dispatch metadata는 서비스 내부 v1 제안 계약으로 검증한다. `sessionId`와 `lessonId`는
   canonical UUID, `correlationId`는 길이가 제한된 안전 문자열이어야 한다. 알 수 없는 필드,
   중복 필드, 과대 payload는 audio/engine/Redis를 열기 전에 거부한다.
2. assigned room과 connected room은 모두 정확히 `session-{sessionId}`여야 한다. 이 검증으로 잘못
   dispatch된 job이 다른 세션의 자막을 쓰는 것을 막는다.
3. 한 세션에는 Redis lease owner 하나만 허용한다. application Redis의 URL을 `REDIS_URL`로
   주입하며 LiveKit 내부 Redis 또는 host `6380`을 가정하지 않는다.
4. STT event consumer는 room job 안에 하나만 둔다. caption mapper는 전달받은 `TextDelta`와
   `EngineCompleted`만 변환하며 `engine.events()`를 별도로 소비하지 않는다.
5. caption은 Redis `XADD`를 직접 await한다. publish 실패나 timeout은 job 실패다. 다만 Redis가
   commit한 뒤 응답만 유실된 in-flight write는 결과를 알 수 없으므로 consumer가 `eventId`를
   멱등 처리해야 한다. 현 시간값은 Spring session clock이 아니라 첫 수신 audio frame 기준이므로
   `streamElapsedMs`라는 이름으로 외부화한다. `sequence` 범위는 `(sessionId, sttSessionId)`로
   식별되는 한 job attempt이며 completion도 같은 `sttSessionId`를 포함한다. 따라서 순차 retry가
   새 ID 아래 `sequence=1`부터 재시작해도 이전 attempt와 충돌하지 않는다.
6. LiveKit `ROOM_DELETED`만 정상 input EOF로 취급해 bounded drain과 `engine.finish()`를 수행한다.
   다른 disconnect, cancellation, lease loss, backlog, provider 오류는 성공 또는 caption completion으로
   바꾸지 않는다.
7. lifecycle callback body와 HMAC client를 AI 제안 계약으로 제공하되 기본값은 비활성화한다.
   retry는 동일 event ID와 동일 raw body만 재전송한다. timeout 뒤 반대 terminal 상태를 새 event로
   만들지 않는다.
8. 별도 Python stop HTTP API는 만들지 않는다. Spring이 소유한 LiveKit room lifecycle과 Redis
   command 제어면을 중복시키면 delete/command 순서 경쟁, ack, 멱등성, 인증 계약이 새로 필요하기
   때문이다.
9. runnable AgentServer는 active job 수를 제한한다. 당시 Nemotron active job은 1개로 강제했다.
   이 수치와 실행 방식은 후속 측정 및 [ADR-0028](0028-stt-provider-execution-profile-and-warm-pool.md)의
   child별 독립 model profile(active 최대 12)로 대체됐다.
10. session lease를 얻지 못한 중복 job은 lifecycle callback을 발행하지 않는다. ownership을 얻지
    못한 attempt의 `FAILED`가 같은 session의 active owner 상태를 덮지 않게 하기 위한 fail-closed
    정책이다.
11. LiveKit Agents 1.6.6이 room disconnect 뒤 user entrypoint를 약 15초 안에 끝내도록 강제하므로,
    `ROOM_DELETED`부터 기본 12초의 absolute deadline 하나를 시작한다. audio/event drain, 내부 cleanup,
    completion write, terminal callback, lease/report cleanup은 모두 같은 남은 budget을 사용한다. 설정
    상한은 13초로 두어 SDK cancellation 전 headroom을 남긴다.
12. lease loss나 client timeout이 in-flight Redis/HTTP write와 경쟁하면 remote commit 여부는 unknown일
    수 있다. cancellation만으로 no-write를 주장하지 않고 Redis event ID dedupe, callback
    `Idempotency-Key`, 후속 Java 채택 시 owner fencing을 consumer gate로 둔다.
13. completion `XADD`를 시작하면 remote 결과가 성공 또는 unknown인 terminal 구간에 진입하므로 새
    `FAILED`를 만들지 않는다. 성공 응답은 attempt의 확정적인 point-of-no-return이다. 이후
    `SUCCEEDED` callback 구간의 cancellation/lease loss로 callback이 누락될 수는 있지만, 이미 닫힌
    caption stream에 반대되는 terminal event를 만들지 않는다.

스키마와 fixture는 `ai/realtime-agent/contracts/`에 둔다. 이는 Java와
`docs/CONTRACT.md`가 채택한 공유 계약이 아니라, 후속 협의를 위한 실행 가능한 AI-side proposal이다.

## 영향

- Python 단위 테스트에서 metadata, room binding, lease ownership, caption 순서와 직렬화, callback
  서명, 정상/비정상 종료 및 cleanup을 검증할 수 있다.
- Java 코드를 수정하지 않고 Python producer와 client 경계를 준비할 수 있다.
- 현재 Java가 named dispatch를 만들거나 caption/callback을 소비하지 않으므로 이 MR만으로 CP2
  live caption E2E가 완료되지는 않는다.
- Spring이 계약을 채택할 때 `docs/CONTRACT.md`, Java DTO/consumer/멱등 처리, session clock 변환과
  양측 fixture를 같은 common MR에서 갱신해야 한다.
- 실제 Redis, LiveKit, Spring 왕복과 OpenAI credential smoke는 단위 테스트 통과와 별도의 검증
  증거로 관리한다.
