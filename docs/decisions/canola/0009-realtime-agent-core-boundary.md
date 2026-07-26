# ADR-0009: realtime-agent의 LiveKit audio·STT core를 외부 계약과 분리

- **상태**: 채택
- **일자**: 2026-07-26
- **관련**: [ADR-0008](0008-ai-fastapi-service-boundaries.md),
  [songjeongki ADR-0008](../songjeongki/0008-ai-bus-redis-streams-session-clock.md),
  [ADR-0011](../songjeongki/0011-ai-three-services.md),
  [ADR-0013](../songjeongki/0013-unified-streaming-stt.md)

## 맥락

원본 AI 브랜치의 realtime-agent는 LiveKit audio, Spring dispatch metadata, Redis caption stream,
session lease와 callback을 한 번에 연결한다. 그러나 현재 master에는 Spring dispatch producer와
공유 metadata 계약이 없고, LiveKit participant identity도 session과 user에서 만든 불투명 UUID다.
이 상태에서 custom metadata Python parser를 먼저 넣으면 검증되지 않은 공용 계약이 된다.

반면 현재 Java 토큰 정책은 강사에게만 publish grant를 주고 수강생은 subscribe-only로 제한하며
이를 backend 계약 테스트로 검증한다. 따라서 초기 audio 선택에는 별도 `instructorIdentity` payload가
필요하지 않다.

또한 첫 audio frame부터 누적한 시간은 Spring의 session start를 기준으로 한 session-relative ms와
같지 않다. 두 좌표를 같은 필드로 외부에 노출하면 녹화·자막 정렬이 어긋날 수 있다.

## 결정

이번 단계는 AI 내부의 다음 요소만 도입한다.

1. LiveKit Agents SDK 1.6.x를 사용한 단일 remote microphone publisher 선택·PCM 수신 adapter
2. provider-neutral streaming STT port와 test/dev 전용 stub
3. 첫 수신 frame부터 계산한 내부 시간 `streamElapsedMs`

`AgentServer`, custom dispatch metadata, caption payload, Redis, callback과 session clock 변환은
포함하지 않는다. SDK queue backlog·drop 관측과 과부하 정책도 실제 STT provider wiring 단계로
미룬다. 초기 Java dispatch는 LiveKit의 room과 agent name만 사용해 backend MR로 구현할 수 있다.
향후 별도 metadata가 필요해지면 Spring producer와 Python consumer를 함께 구현하는 common MR에서
공유 fixture와 계약 테스트를 추가한다.

## 영향

- 이번 MR만으로 realtime-agent 프로세스를 실행하거나 실제 자막을 발행할 수 없다.
- Java/Spring과 공유하는 payload가 없어 backend와 `docs/CONTRACT.md`는 변경하지 않는다.
- terminal failure가 발생하면 이미 대기 중인 PCM보다 오류를 먼저 전달해 상위 job이 즉시 실패한다.
- 실행 wiring 전 backlog 제한, drop 관측과 과부하 실패 정책을 함께 확정해야 한다.
- room 종료·flush 신호가 정의되기 전에는 정상 completion을 구현 완료로 간주하지 않는다.
