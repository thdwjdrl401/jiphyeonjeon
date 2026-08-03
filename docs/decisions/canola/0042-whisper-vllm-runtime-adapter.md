# ADR-0042: Whisper 운영 추론은 loopback vLLM model owner와 provider adapter로 전환한다

- **상태**: 채택
- **일자**: 2026-08-03
- **관련**: [ADR-0027](0027-realtime-stt-shared-gpu-runtime.md),
  [ADR-0032](0032-realtime-agent-service-health-contract.md),
  [ADR-0039](0039-production-vad-stt-experiment-runner.md),
  [ADR-0040](0040-stt-fine-tuning-dry-run-and-promotion.md),
  [ADR-0041](0041-aihub-dual-transcription-evaluation.md)

## 맥락

ADR-0041의 동일 dev·VAD 기준선에서 Whisper Large V3 BF16은 Nemotron보다 multi-reference CER가
상대 32.83% 낮았고 missing final도 0이었다. 아직 paced/concurrency, hallucination, test 1회와
fine-tuned checkpoint 승격 gate가 남았으므로 이 결과만으로 운영 모델을 즉시 교체할 수는 없다.

현재 Nemotron provider는 LiveKit job child마다 CUDA model을 한 벌씩 적재한다. Whisper Large V3도 같은
방식으로 연결하면 worker 수만큼 model weight와 CUDA context가 중복되고, 학습 완료 checkpoint를
교체할 때 agent process lifecycle과 model lifecycle이 다시 결합된다. 반면 STT lab에서 검증한 vLLM
OpenAI-compatible transcription endpoint는 model을 별도 process 한 벌에 상주시킬 수 있다.

vLLM의 Whisper endpoint는 PCM frame마다 delta를 내는 진짜 streaming RPC가 아니다. 서비스가 이미
사용하는 client VAD segment를 요청 단위로 보내고 segment final만 받는 구조다. 따라서 더 빠른
첫 delta를 제공한다고 표현하거나 Nemotron의 incremental output과 같은 의미로 다루면 안 된다.

## 결정

### 1. model owner와 LiveKit agent를 분리한다

GPU 0에 rootless vLLM process 하나를 두고, prod realtime-agent의 job child는 CUDA model을 직접
적재하지 않는 HTTP client가 된다.

~~~mermaid
flowchart LR
    LK[LiveKit instructor audio] --> A[realtime-agent room job]
    A --> V[공통 20 ms VAD]
    V -->|최대 8초 WAV segment| C[vllm-whisper adapter]
    C -->|loopback /v1/audio/transcriptions| R[vLLM model owner GPU 0]
    R -->|text final| C
    C --> S[Full TextDelta + SegmentFinal + sessionMs]
    S --> RS[(Redis caption stream)]
~~~

LiveKit dispatch, audio clock, VAD, Redis sequence, lease와 Spring lifecycle은 기존 agent가 계속 소유한다.
vLLM은 model·processor·CUDA context와 inference scheduling만 소유하며 LiveKit·Redis·Spring을 모른다.

### 2. vllm-whisper provider 계약을 고정한다

provider 설정은 다음 환경변수로만 주입한다.

- VLLM_WHISPER_BASE_URL: 기본 http://127.0.0.1:18083/v1; loopback HTTP와 /v1만 허용
- VLLM_WHISPER_MODEL: /v1/models에 노출되는 stable served-model alias
- VLLM_API_KEY: 별도 인증된 runtime을 붙일 때만 사용하는 선택값
- VLLM_WHISPER_REQUEST_TIMEOUT_SECONDS, VLLM_WHISPER_CONNECT_TIMEOUT_SECONDS

adapter는 stream 시작 전에 /v1/models에서 alias의 정확한 일치를 확인한다. 각 공통 VAD segment를
mono PCM16 WAV multipart로 보내고 language=ko, temperature=0, seed=0으로 요청한다. 응답은 partial
streaming이 아니므로 문자열 text 전체를 `TextDelta` 한 번으로 발행한 뒤 같은 text를 권위 있는
`SegmentFinal`로 낸다. `incremental_deltas=False`는 중간 partial이 없다는 뜻이며 Redis의
delta-before-final 계약은 그대로 유지한다.

학습 run ID나 checkpoint 절대경로를 agent profile에 넣지 않는다. vLLM supervisor가 Git 밖의
승격 checkpoint 경로를 읽고 stable alias로 노출한다. runtime artifact는 processor/tokenizer와
full model config·weight를 함께 가진 vLLM load-smoke 통과 디렉터리여야 한다. LoRA 학습 결과라면
adapter 원본은 보존하되 운영 경로에는 별도로 검증한 merged full checkpoint를 둔다. checkpoint를
바꿀 때 runtime을 재시작하고 같은 alias가 ready가 된 뒤 agent를 연결한다.

### 3. readiness는 process marker와 model owner를 모두 확인한다

child setup은 /v1/models probe가 성공해야 process readiness marker를 기록한다. 이후
GET /health/ready를 호출할 때도 vLLM endpoint와 served-model alias를 다시 확인한다.

따라서 다음 중 하나라도 발생하면 기존 health contract의 modelsReady=false, HTTP 503으로 응답한다.

- vLLM process 종료 또는 재시작 중
- HTTP timeout·오류·비정상 JSON
- 설정 alias와 현재 checkpoint alias 불일치
- 필요한 agent child prewarm 미완료

health JSON 필드는 추가하지 않는다. modelsReady의 의미를 “agent process resource와 선택된 외부
model owner가 모두 준비됨”으로 확장하므로 Spring·FE DTO 변경은 없다.

### 4. rootless runtime과 GPU 경계를 고정한다

liveclass-whisper-vllm-bootstrap은 sudo 없이 사용자 venv에 vllm[audio]==0.11.2를 설치한다.
liveclass-whisper-vllm-supervisor는 tmux에서 runtime을 재기동하고 /v1/models의 exact alias로
상태를 판정한다.

- CUDA_VISIBLE_DEVICES=0만 허용하고 GPU 1로 fallback하지 않는다.
- 서버 bind는 127.0.0.1만 허용한다.
- 모델과 processor artifact는 Git 밖에 두며 env에는 경로만 둔다.
- 기존 BGE와 GPU 0을 공유하므로 첫 운영값은 GPU memory utilization 0.08,
  max-num-batched-tokens=2048, max-num-seqs=1, agent active/idle 1/1이다.
  Whisper audio item의 encoder budget 1500보다 작은 자동값 448은 vLLM 시작을 실패시키므로 허용하지 않는다.
- vLLM runtime과 기존 Nemotron process를 동시에 GPU에 상주시키지 않는다.
- vLLM version, dtype, memory utilization과 concurrency 변경은 같은 checkpoint의 ADR-0039 report로
  다시 검증한다.

vLLM의 batching 가능성만으로 room cap을 12로 두지 않는다. paced concurrency 1/4/12에서 drop, OOM,
timeout 0과 latency budget을 증명한 수치까지만 별도 변경으로 올린다.

### 5. 기본 모델 적용과 학습 모델 승격을 분리한다

첫 runtime profile은 현재 내려받은 `openai/whisper-large-v3` 기본 모델과
`liveclass-whisper-large-v3` alias를 사용한다. 따라서 학습 완료를 기다리지 않고 provider wiring,
readiness, latency와 LiveKit canary를 검증할 수 있다. 다만 merge 자체는 기존 realtime-agent.env의
Nemotron 기본값을 자동 변경하지 않으며 실제 process 교체는 아래 수동 순서로만 수행한다.

1. 새 운영 명령을 설치하고 vLLM 사용자 venv를 bootstrap한다.
2. whisper-vllm.env의 기본 모델 경로와 stable alias를 확인한다.
3. prod agent를 중지해 Nemotron CUDA model을 반환한다.
4. vLLM supervisor를 시작하고 /v1/models에서 exact alias를 확인한다.
5. 기존 prod env를 백업하고 opt-in realtime-agent-vllm.env.example 값으로 교체한다.
6. prod agent를 재시작하고 GPU :8081, EC2 reverse :18081 readiness와 실제 LiveKit canary를
   확인한다.
7. canary와 caption sequence가 모두 정상일 때만 기본 모델 serving 적용 완료로 기록한다.
8. 학습 checkpoint가 ADR-0040/0041 승격 gate를 통과하면 processor 포함 merged full checkpoint로
   model path를 교체하고 같은 절차를 다시 실행한다.

rollback은 prod agent 중지, vLLM 중지, 기존 Nemotron env 복원, prod agent 재시작 순서다. 마지막
승격 checkpoint와 기존 Nemotron model 경로를 모두 보존한다.

## 대안

| 대안 | 판단 |
|---|---|
| Whisper를 job child마다 직접 적재 | model·CUDA context 중복과 lifecycle 결합으로 기각 |
| vLLM을 외부 inbound에 공개 | 현재 GPU 보안 경계와 불필요한 공격면 때문에 기각 |
| vLLM response를 잘게 잘라 delta처럼 발행 | 실제 provider 진행 정보가 아니므로 기각 |
| merge 즉시 prod env를 Whisper로 교체 | 아직 남은 승격 gate와 checkpoint 부재 때문에 기각 |
| loopback model owner + final-only provider + 명시적 전환 | model 공유, rollback, 기존 caption 계약을 함께 만족해 채택 |

## 영향과 검증

- StreamingSttEngine, Redis caption payload, health JSON 필드와 Spring/FE API 계약은 변하지 않는다.
  따라서 docs/CONTRACT.md와 FE/BE 계약 테스트 변경은 불필요하다.
- provider 단위 테스트는 loopback URL, bearer token 비노출, exact model alias, WAV multipart,
  한국어 파라미터, final-only event와 시작 전 runtime 실패를 검증한다.
- catalog 테스트는 보수적 1/1 profile, process prewarm probe와 동적 readiness를 검증한다.
- 운영 스크립트 테스트는 GPU 0·loopback·rootless 설치, shell 문법과 opt-in profile을 검증한다.
- 실제 모델 품질 완료 증거는 이 MR의 단위 테스트가 아니라 ADR-0039/0040의 paced/concurrency,
  test 1회, LiveKit canary artifact다. 해당 gate 전에는 “Whisper 운영 전환 완료”로 보고하지 않는다.
