# ADR-0010: realtime-agent room job은 외부 sink 전에 내부 pump로 분리

- **상태**: 채택
- **일자**: 2026-07-27
- **관련**: [ADR-0009](0009-realtime-agent-core-boundary.md)

## 맥락

원본 `feat/ai/mvp-service-scaffold`의 `d752a96`은 LiveKit room job, Spring dispatch metadata,
caption payload와 Redis publisher를 한 실행 경로에 묶는다. 현재 기준선에는 audio source와
provider-neutral STT port만 있고, Spring과 Python이 함께 검증한 metadata·caption 계약은 없다.

원본 room job의 단일 `chunks() -> push_audio()` pump와 실패 시 정리는 독립적으로 유효하다.
반면 외부 caption sink 없이 `AgentServer`부터 등록하면 dispatch는 성공해도 결과를 버리는
실행 프로세스가 되어 운영상 가짜 성공을 만든다.

## 결정

이번 단계는 원본 room job에서 다음 AI 내부 동작만 선별 이식한다.

1. `LiveKitInstructorAudioSource.chunks()`를 정확히 한 consumer가 순차 소비한다.
2. 각 PCM chunk를 하나의 `StreamingSttEngine`에 한 번씩 전달한다.
3. engine의 nonterminal event는 `EngineEventSink` port로 동시에 drain해 장시간 job의 queue 누적을 막는다.
4. Spring metadata를 읽지 않고 LiveKit job ID를 임시 AI 내부 `streamId`로 사용한다.
5. LiveKit connect가 끝난 뒤 assigned room과 connected room을 비교한다.
6. 정상·실패·취소에서 audio source와 engine을 모두 닫고, 원래 오류를 cleanup 오류로 가리지 않는다.
7. `EngineCompleted`는 외부 sink에 전달하지 않고, finish 요청 뒤 도착했는지 내부에서 검증한다.

`AgentServer`, process entrypoint, event sink 구현, Redis, caption payload, callback, session lease와
실제 STT provider는 포함하지 않는다. 따라서 backend, `docs/CONTRACT.md`, lockfile도 바꾸지 않는다.

## 영향

- 이번 MR은 실제 agent worker를 LiveKit에 등록하지 않으며 자막을 외부로 발행하지 않는다.
- 후속 caption 계약 MR은 `EngineEventSink`를 구현하고, 종료·flush 경계를 정한 뒤에만
  `AgentServer` entrypoint를 연결한다.
- `streamId=job.id`는 외부 계약이 아니다. session 식별자가 필요해지는 시점에 Spring producer와
  Python consumer를 함께 구현하고 계약 테스트로 고정한다.
- 테스트는 chunk 무손실 단일 전달, event drain, room 검증 시점, 실패·취소·cleanup을 검증한다.
