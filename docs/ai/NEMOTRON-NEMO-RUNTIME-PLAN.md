# Tuned Nemotron NeMo final-only runtime 개발 계획

> 현재 상태: 구현됨. provider는 `ai/realtime-agent/app/stt/providers/nemotron_nemo.py`, runtime은
> `ai/realtime-agent/deploy/runtime/nemotron_nemo_server.py`, env 예시는 `deploy/env/nemotron-nemo.env.example`·
> `realtime-agent-nemo.env.example`이다. §4의 tmux supervisor(`deploy/bin/liveclass-nemotron-nemo-supervisor`)는
> 커밋 `c490634b`에서 삭제됐고, tuned `.nemo` checkpoint는 저장소 밖 GPU 서버에만 있었다
> ([`deploy/README.md`](../../ai/realtime-agent/deploy/README.md)).

## 1. 목표

6,000 step full fine-tuning 결과인 Prompt-RNNT `.nemo` archive를 GPU 0에 5개 replica로 적재하고,
realtime-agent가 기존 VAD로 확정한 발화 단위 PCM을 전달해 완성 문장 하나를 받는다.

- dev/prod LiveKit worker, VAD, Redis publisher와 caption payload는 변경하지 않는다.
- Java가 소비하는 `TextDelta.text`에는 한 발화의 완성 문장 전체가 한 번에 들어간다.
- 동일 문장은 기존 `caption.segment.final`에도 기록된다.
- native cache-aware streaming, partial token, 5개 초과 replica, 자동 복구는 이번 범위가 아니다.

## 2. 현재 흐름과 변경 지점

```text
LiveKit microphone PCM
  -> AudioNormalizer (16 kHz mono PCM16)
  -> VadSegmenter (silence/max-duration에서 SpeechSegment 확정)
  -> NemotronNeMoEngine                         [신규]
  -> loopback NeMo runtime /v1/audio/transcriptions [신규]
  -> ProviderSegmentFinal(완성 문장)
  -> SegmentedStreamingEngine
       -> TextDelta(완성 문장) 1건
       -> SegmentFinal(동일 문장) 1건
  -> 기존 CaptionEventMapper
  -> 기존 RedisCaptionPublisher
  -> Java consumer
```

수정 금지 경계:

- `app/adapters/redis_caption_publisher.py`
- Redis stream key와 field
- `CaptionDelta`, `CaptionSegmentFinal` payload
- Spring/Frontend 계약과 `docs/CONTRACT.md`

## 3. 선택한 구조

### 독립 NeMo model-owner process pool

realtime-agent venv에는 NeMo를 섞지 않는다. 학습에서 검증한 고정 NeMo venv가 runtime을 실행한다.
runtime은 loopback에만 bind하고 동일 checkpoint를 5개 독립 process가 각각 복원한다.

```text
NEMO_RUNTIME_VENV=/home/liveclass/ai/training/nemotron-3.5-full-20260803/.venv
NEMO_RUNTIME_MODEL_PATH=.../LiveClass-Nemotron-3.5-ASR-Full-Finetune.nemo
NEMO_RUNTIME_HOST=127.0.0.1
NEMO_RUNTIME_PORT=18084
NEMO_RUNTIME_SERVED_MODEL_NAME=liveclass-nemotron-tuned-v1
NEMO_RUNTIME_REPLICAS=5
CUDA_VISIBLE_DEVICES=0
```

### 최소 HTTP 계약

`GET /health/live`

- HTTP process가 요청을 받을 수 있으면 200.

`GET /health/ready`

- `.nemo` 복원, Korean prompt 설정, CUDA 이동이 끝나면 200.
- server socket은 load 완료 뒤 열리며, 이후 model state가 비정상이면 503.

`GET /v1/models`

- exact served-model alias를 반환한다.

`POST /v1/audio/transcriptions`

- multipart: `model`, `language=ko-KR`, `file`(mono PCM16 WAV)
- 성공: `200 {"text":"완성 문장"}`
- 빈 인식도 정상 응답: `200 {"text":""}`
- Linux `SO_REUSEPORT`가 같은 loopback port의 독립 process 5개에 요청을 분산한다.

## 4. 구현 단위

1. `nemo-runtime/`에 표준 라이브러리 HTTP server와 model wrapper를 둔다.
2. wrapper는 `ASRModel.restore_from()`, `set_inference_prompt("ko-KR")`, language tag 제거,
   각 process가 FP32 CUDA model과 독립 CUDA context를 소유한다.
3. realtime-agent에 loopback URL·model alias·timeout 설정과 `nemotron-nemo` provider를 추가한다.
4. provider는 기존 `SegmentedStreamingEngine`을 상속하고 WAV multipart 요청 뒤
   `ProviderSegmentFinal` 하나만 반환한다.
5. 사용자 tmux supervisor와 env example을 추가한다.
6. prod profile은 `STT_ENGINE_PROVIDER=nemotron-nemo`, active/idle 기본 `5/5`, 상한 5와 runtime replica 기본 5를 사용한다.

## 5. 의도적으로 제외하는 것

- `conformer_stream_step()` 기반 partial streaming
- WebSocket/session cache protocol
- dynamic batching과 동시성 5 초과
- circuit breaker, 자동 fallback, 무중단 drain
- `.nemo`에서 Hugging Face로의 비공식 weight 변환
- Redis/Java/Frontend 변경

## 6. 검증 순서

1. 단위 테스트: 설정, loopback 제한, model alias, WAV request, 완성 문장 단일 final.
2. runtime fake-model 테스트: live/ready/models/transcriptions 상태코드와 replica 병렬 실행.
3. shell 문법과 env profile 테스트.
4. tuned `.nemo` SHA-256이 ADR-0046의
   `4cf5368cbb9d57a48ee0b5afbb3790deedd4612963a095b2db30d3f7f57c79fa`와 일치하는지 확인.
5. GPU 0 runtime load와 기존 AI Hub WAV 1건 smoke.
6. prod agent를 `nemotron-nemo`로 재시작하고 `/health/ready` 200 확인.
7. 테스트 room 또는 기존 dispatch로 음성을 흘려 Redis에 완성 문장 한 건이 들어가는지 확인.

## 7. 완료 기준

- tuned model runtime의 replica 5개와 prod agent process 5개가 모두 ready다.
- VAD segment 한 건당 provider가 완성 text 하나만 반환한다.
- 기존 Redis contract test가 수정 없이 통과한다.
- 실제 음성 smoke에서 Redis `text`에 제어 prefix나 token 조각이 아닌 완성 문장이 기록된다.
- dev worker와 BGE는 영향을 받지 않는다.

## 8. 롤백

prod env를 기존 HF Nemotron으로 되돌리고 prod agent만 재시작한다.

```text
STT_ENGINE_PROVIDER=nemotron
ASR_MODEL_ID=/home/liveclass/ai/models/nemotron-3.5-asr-streaming-0.6b
STT_MAX_ACTIVE_JOBS=1
STT_NUM_IDLE_PROCESSES=1
```

NeMo runtime은 별도로 중지한다. Redis와 Java 설정은 변경하지 않았으므로 추가 롤백은 없다.

## 구현 결과

5-way 확장 결과와 동일-process CUDA Graph 실패, 독립 process 전환 근거는 [ADR-0084](../decisions/canola/0084-tuned-nemotron-nemo-final-runtime.md)의 병렬 확장 검증에 고정한다.
