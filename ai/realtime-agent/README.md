# realtime-agent core

LiveKit 방의 오디오 track을 안전하게 읽고, provider-neutral streaming STT port로 넘기는
AI 내부 core다. 이 단계는 stream 단위 PCM16 정규화와 room job의 단일 오디오 pump·자원 정리까지
제공하지만 실행 가능한 agent server는 아니다.

## 현재 구현 범위

- 방에서 유일한 remote microphone publisher를 선택 구독
- 같은 publisher가 microphone을 여러 개 발행해도 한 track만 수신
- 예상 밖의 두 번째 microphone publisher가 나타나면 fail-closed
- 기존 publication scan과 publish/unpublish/subscription failure 처리
- 48 kHz mono PCM chunk와 첫 수신 frame 기준 `streamElapsedMs` 생성
- PCM chunk stream의 단일 consumer 강제
- provider-neutral `StreamingSttEngine` port
- 외부 식별자를 포함하지 않는 test/dev 전용 stub engine
- stream별 상태를 유지하는 PCM16 mono downmix와 16 kHz resampling primitive
- LiveKit job ID를 AI 내부 stream ID로 사용하는 metadata-free room job
- `chunks()`를 한 번만 소비해 각 PCM chunk를 STT engine에 순서대로 한 번씩 전달
- STT nonterminal event를 외부 계약과 분리된 sink로 동시에 drain
- engine completion은 조기 외부 발행 없이 room job 내부 수명주기로 검증
- 정상·실패·취소 경로에서 audio source와 STT engine 정리

`streamElapsedMs`는 agent가 실제로 받은 오디오 길이이며 Spring의 세션 시작 시각을 기준으로 한
session-relative ms가 아니다. 이 값은 이번 단계에서 외부 메시지로 발행하지 않는다.

`Pcm16Normalizer`는 하나의 오디오 stream마다 새 인스턴스를 사용한다. chunk 사이의 resampler
상태를 보존하지만 아직 room job이나 실제 STT provider에 연결하지 않는다. 현재 Python 3.12의
`audioop`을 사용하므로 Python 3.13으로 올리기 전에 대체 구현을 선택해야 한다.

## 의도적으로 포함하지 않은 범위

- `AgentServer` 등록과 프로세스 entrypoint
- Spring dispatch metadata와 instructor identity 전달 계약
- Redis caption stream, session lease, Spring callback
- caption sequence와 session clock 변환
- OpenAI/Nemotron 실제 STT provider
- VAD, 20 ms framing과 발화 segment 정책
- SDK queue backlog·drop 관측 및 과부하 정책

현재 Java는 강사에게만 publish grant를 주고 수강생에게는 subscribe grant만 준다. 따라서 초기
dispatch는 custom metadata 없이 LiveKit의 room과 agent name만으로 연결할 수 있다. 향후 별도 업무
metadata가 필요해지면 양쪽 계약 테스트와 함께 common MR에서 정의한다. 현재 room job의
`EngineEventSink`는 결과를 버리는 구현이 아니라 후속 caption publisher가 반드시 구현해야 하는
내부 port다. room 종료·flush와 실제 sink가 정해지기 전에는 runnable realtime-agent 완료를
주장하지 않는다.

## 검증

```powershell
uv sync --frozen
uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check app tests
```
