# realtime-agent core

LiveKit 방의 오디오 track을 안전하게 읽고, provider-neutral streaming STT port로 넘기는
AI 내부 core다. 이 단계는 PCM16 정규화·VAD segmentation, OpenAI Realtime/Nemotron adapter와
room job의 단일 오디오 pump·자원 정리까지 제공하지만 실행 가능한 agent server는 아니다.

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
- 20 ms frame, 발화 시작 200 ms preroll과 실제 PCM 길이 기준 최대 8초를 적용하는 WebRTC VAD segmenter
- append-only 자막 중복을 막는 overlap 없는 강제 분할 경계
- bounded segment/event queue를 사용하는 provider-neutral serial segment lifecycle
- 현재 Realtime transcription session 계약을 따르는 OpenAI WebSocket adapter
- lazy local recognizer를 사용하는 Nemotron adapter와 optional CUDA 의존성
- provider 이름을 정규화하고 중복·미등록 선택을 거부하는 내부 registry
- LiveKit job ID를 AI 내부 stream ID로 사용하는 metadata-free room job
- `chunks()`를 한 번만 소비해 각 PCM chunk를 STT engine에 순서대로 한 번씩 전달
- STT nonterminal event를 외부 계약과 분리된 sink로 동시에 drain
- engine completion은 조기 외부 발행 없이 room job 내부 수명주기로 검증
- 정상·실패·취소 경로에서 audio source와 STT engine 정리

`streamElapsedMs`는 agent가 실제로 받은 오디오 길이이며 Spring의 세션 시작 시각을 기준으로 한
session-relative ms가 아니다. 이 값은 이번 단계에서 외부 메시지로 발행하지 않는다.

`Pcm16Normalizer`와 `VadSegmenter`는 하나의 오디오 stream마다 새 인스턴스를 사용한다. OpenAI와
Nemotron adapter는 이 segment lifecycle을 공유하지만 아직 room job의 provider 선택에 연결하지
않는다. 현재 Python 3.12의 `audioop`을 사용하므로 Python 3.13으로 올리기 전에 대체 구현을
선택해야 한다.

LiveKit frame은 20 ms로 받고 자체 queue에 최대 250개, 약 5초를 보관한다. SDK queue에 유한
capacity를 주면 오래된 frame이 조용히 제거되므로 그 기능은 사용하지 않는다. 자체 queue가 가득
차면 audio를 drop하지 않고 `AudioBacklogError`로 job을 실패시킨다. overflow ERROR 로그에는
track·queue depth·capacity·backlog ms가, segment 완료 DEBUG 로그에는 provider·segment 길이·provider
대기 시간·queue depth가 포함된다. 5초는 capture queue만의 한계이며 전체 pipeline latency 상한은
아니다.

## 의도적으로 포함하지 않은 범위

- `AgentServer` 등록과 프로세스 entrypoint
- Spring dispatch metadata와 instructor identity 전달 계약
- Redis caption stream, session lease, Spring callback
- caption sequence와 session clock 변환
- 환경 변수 기반 provider 선택과 room job wiring
- 실제 OpenAI API credential smoke
- Nemotron 모델 다운로드·실제 CUDA inference smoke와 process-wide model sharing

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

Nemotron 실행 의존성은 기본 CPU 테스트 환경과 분리한다.

```powershell
uv sync --frozen --extra nemotron
```
