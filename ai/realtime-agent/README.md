# realtime-agent core

LiveKit 방의 오디오 track을 안전하게 읽고, provider-neutral streaming STT port로 넘기기 위한
AI 내부 core다. 이 단계는 실행 가능한 agent server가 아니라 이후 wiring의 기반만 제공한다.

## 현재 구현 범위

- 방에서 유일한 remote microphone publisher를 선택 구독
- 같은 publisher가 microphone을 여러 개 발행해도 한 track만 수신
- 예상 밖의 두 번째 microphone publisher가 나타나면 fail-closed
- 기존 publication scan과 publish/unpublish/subscription failure 처리
- 48 kHz mono PCM chunk와 첫 수신 frame 기준 `streamElapsedMs` 생성
- PCM chunk stream의 단일 consumer 강제
- provider-neutral `StreamingSttEngine` port
- 외부 식별자를 포함하지 않는 test/dev 전용 stub engine

`streamElapsedMs`는 agent가 실제로 받은 오디오 길이이며 Spring의 세션 시작 시각을 기준으로 한
session-relative ms가 아니다. 이 값은 이번 단계에서 외부 메시지로 발행하지 않는다.

## 의도적으로 포함하지 않은 범위

- `AgentServer`와 room job entrypoint
- Spring dispatch metadata와 instructor identity 전달 계약
- Redis caption stream, session lease, Spring callback
- caption sequence와 session clock 변환
- OpenAI/Nemotron 실제 STT provider
- SDK queue backlog·drop 관측 및 과부하 정책

현재 Java는 강사에게만 publish grant를 주고 수강생에게는 subscribe grant만 준다. 따라서 초기
dispatch는 custom metadata 없이 LiveKit의 room과 agent name만으로 연결할 수 있다. 향후 별도 업무
metadata가 필요해지면 양쪽 계약 테스트와 함께 common MR에서 정의한다. room 종료·flush 경계가
정해지기 전에는 runnable realtime-agent 완료를 주장하지 않는다.

## 검증

```powershell
uv sync --frozen
uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check app tests
```
