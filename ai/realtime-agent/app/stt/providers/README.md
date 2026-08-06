# STT providers

## 역할

외부 또는 로컬 STT 구현을 공통 engine 계약에 맞추는 adapter 모음이다.

## 구조와 흐름

registry가 provider를 선택한다. streaming provider는 PCM을 지속 전송하고, segmented provider는 발화 단위로
나눈 뒤 backend를 호출한다. `stub`은 로컬 wiring과 테스트 전용이다.

공통 `SegmentedStreamingEngine`은 16 kHz mono PCM을 client-side VAD segment로 만들고 bounded queue에서
한 segment씩 직렬 처리한다. provider 진행 결과는 `TextDelta`, provider final transcript와 VAD 구간은
`SegmentFinal`로 되돌리므로 caption·Redis 계층은 provider의
wire protocol을 알지 못한다.

## provider별 통신

| provider | 입력·전송 | 응답 | 외부 자격 증명 |
|---|---|---|---|
| `openai-realtime` | 16 kHz PCM을 24 kHz로 resample하고 base64 `input_audio_buffer.append` 후 segment마다 `commit` | 같은 `item_id`의 transcription delta/completed/failed event | `OPENAI_API_KEY` Bearer token |
| `nemotron` | 16 kHz PCM을 NumPy/Transformers adapter로 전달 | local `TextIteratorStreamer` delta | 없음; `ASR_MODEL_ID`의 로컬 checkpoint 사용 가능 |
| `nemotron-nemo` | 공통 VAD segment를 mono PCM16 WAV multipart로 loopback NeMo runtime에 전달 | 완성 transcript `TextDelta` 1회 후 동일 text의 segment final | 없음; loopback 격리 |
| `vllm-whisper` | 공통 VAD segment를 mono PCM16 WAV multipart로 loopback `/v1/audio/transcriptions`에 전달 | 완성 transcript `TextDelta` 1회 후 provider-authoritative segment final | 선택적 `VLLM_API_KEY`; 기본 runtime은 loopback 격리 |
| `stub` | process 내부 입력 | deterministic fake event | 없음 |

OpenAI 연결 URL은 `wss://api.openai.com/v1/realtime?intent=transcription`이다. model은 URL query가 아니라
첫 `session.update`의 `session.audio.input.transcription.model`에 넣는다. 한 job은 WebSocket session
하나를 재사용하고 client VAD가 만든 segment를 순서대로 전송한다. 이미 발행한 realtime delta와 final
transcript가 다르면 `SegmentFinal.text`에 provider final을 권위 값으로 보낸다. 소비자는 `lastSequence`
이하 delta 미리보기를 final로 교체한다.

`nemotron-nemo`도 같은 final-only segmented HTTP 경계를 재사용한다. 차이는 model owner가 vLLM이 아니라 NeMo `ASRModel.restore_from()`으로 full fine-tuned `.nemo`를 한 번 적재한다는 점이다. Redis·caption 계층은 이 차이를 알지 못한다.

vLLM Whisper는 stream 시작 전 `/v1/models`에서 exact served-model alias를 확인한다. frame delta를
지원하지 않으므로 `incremental_deltas=False`다. adapter는 transcription SSE를 내부적으로 끝까지 모아
`finish_reason=stop`인 EOS 정상 종료만 확정한다. `length` 또는 종료 사유 누락은 폐기하며, 동일
문자·단어·구절이 출력의 60% 이상을 네 번 이상 차지하는 병적 반복도 폐기한다. 텍스트 자체의 zlib
압축률이 2.4를 초과하거나 오디오 1초당 공백 제외 문자가 8자를 초과한 출력, 정규화 후 직전 final과 같은
연속 출력도 폐기한다. 통과한 완성 text는 `TextDelta` 한 번과 동일 text의 `SegmentFinal`로 발행해
Redis의 delta-before-final 계약을 유지한다. 설치된 vLLM 0.11.2는 Whisper `verbose_json`을 거부하므로
모델이 계산한 `no_speech_prob`·`avg_logprob`·`compression_ratio`는 사용할 수 없다. 여기서 사용하는
압축률은 모델 지표가 아니라 확정 후보 text를 UTF-8로 인코딩한 뒤 직접 계산한 값이다.

Nemotron 경로에는 외부 network hop이 없다. prewarmed recognizer와 CUDA model은 job child 하나가
독점하고, segment inference는 engine의 lock으로 직렬화한다. model generate thread의 결과는 event loop
queue로 전달하며 close 시 stop event를 보내 GPU 자원을 해제한다.

## 파일 구성

- `openai_realtime.py`: `intent=transcription` session을 사용하는 OpenAI Realtime STT 연결
- `nemotron.py`: 로컬 Nemotron backend adapter
- `nemotron_nemo.py`: tuned NeMo loopback runtime adapter와 readiness probe
- `vllm_whisper.py`: loopback vLLM Whisper transcription adapter와 runtime probe
- `segmented.py`: segment 기반 provider 생명주기
- `stub.py`: 외부 의존성 없는 개발·테스트 구현

## 경계와 불변식

provider 자격 증명과 선택은 환경 변수로 주입한다. `stub` 결과를 실제 STT 품질 검증으로 간주하지 않으며,
Nemotron은 process-wide model을 공유하지 않고 job child마다 독립 model을 소유한다. provider profile은
H200 한 장에서 worker당 active job 상한 12, 기본 warm idle process 12를 사용한다. LiveKit Agents
1.6.6의 초기 burst reservation도 idle 수를 사용하므로 12-request burst에는 두 값을 같게 둔다.
vLLM Whisper는 paced concurrency 검증 전 active/idle `1/1`을 사용하며 GPU 0 model owner만 허용한다.

## 검증

`tests/test_openai_realtime_provider.py`, `tests/test_nemotron_provider.py`,
`tests/test_vllm_whisper_provider.py`, `tests/test_nemotron_nemo_provider.py`, `tests/test_segmented_provider_lifecycle.py`,
`tests/test_stub_engine.py`에서 provider별 계약을 검증한다.
