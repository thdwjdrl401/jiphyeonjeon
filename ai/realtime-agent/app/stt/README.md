# STT engines

## 역할

실시간 오디오 입력과 transcript 이벤트 출력의 provider-neutral 계약을 정의하고 설정에 맞는 구현을 선택한다.

## 구조와 흐름

room job은 공통 engine 인터페이스만 사용한다. catalog가 `stub`, `openai-realtime`, `nemotron`, `nemotron-nemo`, `vllm-whisper`의 engine
factory와 실행 profile을 등록하고, registry가 선택한 구현과 선택적인 prewarmed process resource를
조립한다. 필요하면 audio segmentation을 provider adapter 앞에 둔다.

```text
Room job
  └─ StreamingSttEngine: 16 kHz mono AudioChunk → EngineEvent
       └─ catalog/registry
            ├─ stub             (process 내부, 외부 통신 없음)
            ├─ openai-realtime  (outbound WebSocket)
            ├─ nemotron         (job child가 소유한 local GPU model)
            ├─ nemotron-nemo    (GPU0 loopback tuned .nemo model owner)
            └─ vllm-whisper     (GPU0 loopback vLLM model owner)
```

provider 선택은 `STT_ENGINE_PROVIDER` 한 곳에서 끝난다. room job, caption pipeline, Redis publisher는
provider 이름이나 model별 protocol을 알지 못한다.

## 실행 profile과 자원 수명주기

| provider | 기본 active/idle | process prewarm | 추론 통신 |
|---|---:|---|---|
| `stub` | 1 / 1 | 없음 | process 내부 fake delta |
| `openai-realtime` | 1 / 1 | 없음 | OpenAI Realtime outbound WSS; 실제 동시 수는 API quota에 맞춰 운영자가 제한 |
| `nemotron` | 12 / 12 | child마다 model 1개, 최대 120초 | 로컬 CUDA; 외부 model API 없음 |
| `nemotron-nemo` | 5 / 5 | `/v1/models` exact alias probe, 최대 30초 | loopback HTTP; 독립 NeMo process 5개가 tuned `.nemo`와 CUDA context를 하나씩 소유 |
| `vllm-whisper` | 1 / 1 | `/v1/models` exact alias probe, 최대 30초 | loopback HTTP; vLLM process가 GPU model 한 벌 소유 |

1. parent가 catalog를 만들고 profile만 읽어 `AgentServer` pool을 설정한다.
2. LiveKit child `setup_fnc`가 provider의 process resource를 `process.userdata`에 저장한다.
3. job 시작 시 registry가 resource를 `pop`해 engine에 단 한 번 소유권을 이전한다.
4. engine 종료가 resource와 GPU allocation을 정리한다. prewarm resource가 없으면 Nemotron은
   cold-load로 우회하지 않고 실패한다.

Nemotron의 12-process 방식은 현재 H200 단일 GPU용 단기 구조다. vLLM Whisper는 model owner를
분리했지만 현재 transcription endpoint가 VAD segment final-only이므로 stateful streaming runtime은 아니다. GPU당 model 하나를 공유하는 dynamic batching
runtime은 [ADR-0027](../../../../docs/decisions/canola/0027-realtime-stt-shared-gpu-runtime.md)의 장기
구조이며 아직 이 registry의 구현이 아니다.

## 파일 구성

- `engine.py`: audio write·event iteration·finish·close 계약
- `sentence_boundary.py`: 확정 text를 문장으로 나누는 규칙(과소분할 우선)
- `catalog.py`: provider별 설정 검증, factory와 worker 실행 profile 등록
- `registry.py`: provider 선택, worker pool 해석과 process resource 소유권 이전
- `nemotron_asr.py`: 로컬 Nemotron ASR 실행 경계
- `providers/nemotron_nemo.py`: tuned `.nemo` model owner용 final-only loopback adapter
- `providers/vllm_whisper.py`: loopback OpenAI-compatible Whisper transcription adapter
- `providers/`: provider별 adapter

## 경계와 불변식

audio producer와 event consumer는 각각 하나이며 engine event iterator를 여러 곳에서 소비하지 않는다.
provider-neutral event는 진행 `TextDelta`, 확정 `SegmentFinal`, warning, completed다.
`SegmentFinal`의 단위는 VAD segment가 아니라 문장이다 — 한 segment가 여러 문장을 담으면 문장마다
하나씩 나가고, 시각은 segment 구간을 문장 길이로 나눈 추정치다([ADR-0086](../../../../docs/decisions/canola/0086-caption-line-is-a-sentence.md)).
증분 delta를 내는 provider의 문장 final은 `text_already_delivered`로 표시해 caption mapper가 같은
text를 delta로 다시 만들지 않게 한다.
streaming provider는 segment 오디오를 끝까지 모델에 넣는다 — 남은 조각이 chunk보다 짧으면 버리지 않고
채워서 넣는다([ADR-0088](../../../../docs/decisions/canola/0088-nemotron-streaming-tail-chunk.md)).
finish와 close는 제한된 시간 안에 끝나야 하며 provider 오류를 정상 completion으로 바꾸지 않는다.
CUDA model은 parent에서 만들거나 fork하지 않고 job child setup에서 load한다. process resource가 필요한
provider의 실제 job은 prewarm resource 누락 시 cold-load로 우회하지 않는다. vLLM provider는
process marker뿐 아니라 model owner의 현재 `/v1/models` 응답도 readiness에 포함한다.

## 검증

`tests/test_stt_registry.py`, `tests/test_*provider*.py`, `tests/test_nemotron_asr.py`로 공통 계약과 구현을 검증한다.
