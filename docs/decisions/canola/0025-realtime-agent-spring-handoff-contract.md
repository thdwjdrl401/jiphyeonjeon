# ADR-0025: realtime-agent–Spring 핸드오프 계약은 현재 wire 형식을 정본에 승격

- **상태**: 채택
- **일자**: 2026-07-28
- **관련**: [ADR-0014](0014-realtime-agent-lifecycle-candidate-contract.md),
  [ADR-0022](0022-realtime-caption-stream-retention.md),
  [songjeongki ADR-0040](../songjeongki/0040-caption-delta-contract.md),
  [공유 계약](../../CONTRACT.md#3-내부-계약-확정-인터페이스)

## 맥락

기존 공유 계약 §3-3은 미구현 `caption.partial|final|revised`와 세션 상대 ms를 적고 있었다. 반면 realtime-agent는 LiveKit dispatch metadata, application Redis의 `caption.delta|caption.stream.completed`, 선택적 Spring lifecycle callback을 schema·fixture·Python 계약 테스트로 고정했다. Java에는 아직 해당 producer/consumer/endpoint가 없어 Spring 구현자가 따를 정본 경계가 필요하다.

## 결정

1. realtime-agent 외부 wire 형식 중 Spring이 생산하거나 소비하는 경계만 `docs/CONTRACT.md` §3-3~§3-5에 승격한다.
2. Spring은 `session-{sessionId}` room의 explicit named AgentDispatch, assignment timeout, room 삭제를 소유한다. Python은 Worker 등록·용량 보고·STT job을 소유한다.
3. 자막은 현재 구현처럼 전역 `ai:captions:live` Stream의 append-only `caption.delta|caption.stream.completed`로 계약한다. `(sessionId, sttSessionId)`가 job attempt 범위이며 `eventId`로 중복 제거한다.
4. `streamElapsedMs`는 첫 audio frame 기준 attempt-local 시계다. Spring session/HLS clock 변환은 아직 확정하지 않았으며 세션 상대 ms로 간주하지 않는다.
5. lifecycle callback은 material callback과 다른 `v1=hex(HMAC-SHA256(secret, timestamp + "." + rawBody))` 계약으로 분리하고 Spring endpoint 구현 전까지 Python 기본값을 off로 둔다.
6. 계약 승격은 Java 연동 완료를 뜻하지 않는다. Java serializer·consumer·callback endpoint, 양쪽 contract test, LiveKit·Redis·Spring E2E가 추가되어야 연동 완료다.

## 이번 계약에 포함하지 않는 것

songjeongki ADR-0040의 `caption.segment.final`, `AUDIO_STARTED` time-origin anchor, 세션별 Redis key는 제안 상태이고 현재 realtime-agent wire에 없다. 정본이 구현보다 앞서지 않도록 제외하며 FE 확정 자막·세션 시계·Stream 정리를 함께 다루는 후속 common 계약으로 남긴다.

## 영향

- Spring은 공유 schema·fixture로 serializer/consumer 계약 테스트를 추가해야 한다.
- consumer group·Stream 정리·owner fencing·session clock 변환은 후속 구현 블로커이며, 해소 전에 CP2 E2E 완료로 보고하지 않는다.
- FE WebSocket은 Spring이 변환한 세션 상대 ms를 사용하며 raw `streamElapsedMs`를 직접 소비하지 않는다.
