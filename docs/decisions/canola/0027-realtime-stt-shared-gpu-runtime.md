# ADR-0027: realtime STT는 GPU별 단일 model owner와 stateful dynamic batch로 이행

- **상태**: 제안
- **일자**: 2026-07-28
- **관련**: [ADR-0010](0010-realtime-agent-room-job-boundary.md),
  [ADR-0012](0012-realtime-stt-provider-and-overload-boundary.md),
  [ADR-0024](0024-realtime-agent-gpu-turn-runtime.md),
  [ADR-0026](0026-realtime-stt-concurrency-and-batching.md),
  [realtime-agent CONTRACT](../../../ai/realtime-agent/CONTRACT.md)

## 맥락

ADR-0026은 현행 room/job별 model 구조를 GPU당 12 room으로 제한하고, 장기적으로 GPU별 shared
ASR runtime을 두는 방향을 채택했다. 이 문서는 목표 구조를 현재 코드에 적용할 수 있는 process,
API, cache, scheduler, load balancing과 장애 경계로 구체화한다.

현재 코드는 다음 특성을 가진다.

- room_job은 LiveKit audio와 StreamingSttEngine을 연결하고 Redis caption 및 lifecycle을 소유한다.
- NemotronStreamingEngine은 VAD가 완성한 최대 8초 segment를 방별 recognizer에 직렬로 전달한다.
- NemotronStreamingASR은 방마다 모델을 lazy-load하고 Transformers streaming generate를
  별도 thread에서 실행한다.
- 현재 Transformers streaming generate는 진행 상태를 model 객체 필드에 저장한다. 실제 동시
  호출에서도 내부 상태 충돌이 발생했으므로 model 한 벌의 generate를 여러 room이 공유할 수 없다.
- 반면 하위 model API는 encoder attention cache, causal convolution padding cache와 RNNT decoder
  cache를 명시적으로 입출력하고 batch 차원을 지원한다. generate를 우회한 전용 batched decode
  loop는 구현 가능하다.

16 kHz mono PCM16은 room당 약 32 KiB/s이고 24 room도 약 768 KiB/s다. 같은 host 안에서 이 정도
audio를 전송하려고 shared memory나 CUDA IPC를 먼저 도입할 이유는 없다. 초기 구조는 관측과
backpressure가 명확한 local streaming API를 사용한다.

## 목표와 비목표

### 목표

1. model 가중치는 GPU마다 한 벌만 적재한다.
2. room별 encoder, convolution, decoder cache는 서로 섞이지 않게 유지한다.
3. 여러 room의 준비된 고정 크기 chunk를 한 번의 GPU batch로 실행한다.
4. audio 입력부터 caption delta까지 모든 queue와 deadline을 bounded로 만든다.
5. LiveKit, Redis, Spring lifecycle 계약은 room job에 남긴다.
6. API 전환 뒤에도 session affinity와 capacity admission을 보장한다.
7. GPU별 처리량과 지연을 측정해 admission cap을 실험으로만 올린다.

### 비목표

- 두 H200을 한 inference에 tensor parallel로 묶지 않는다.
- RabbitMQ나 Redis를 실시간 audio transport로 쓰지 않는다.
- runtime 장애 시 다른 GPU로 in-memory RNNT cache를 자동 이전하지 않는다.
- silence 평균치를 근거로 room cap을 초과 예약하지 않는다.
- offline segment batch를 최종 실시간 자막 방식으로 간주하지 않는다.

## 제안 구조

~~~mermaid
flowchart LR
  LK[LiveKit dispatch] --> A0[AgentServer 0<br/>CPU/NUMA 0]
  LK --> A1[AgentServer 1<br/>CPU/NUMA 1]
  A0 --> J0[room job processes]
  A1 --> J1[room job processes]
  J0 --> E0[RuntimeBackedNemotronEngine]
  J1 --> E1[RuntimeBackedNemotronEngine]
  E0 -->|local bidi API| R0[ASR runtime 0<br/>GPU 0 model owner]
  E1 -->|local bidi API| R1[ASR runtime 1<br/>GPU 1 model owner]
  R0 --> B0[stateful batch scheduler]
  R1 --> B1[stateful batch scheduler]
  J0 --> RS[(Redis caption stream)]
  J1 --> RS
~~~

한 GPU의 process 배치는 다음과 같다.

1. asr-runtime@gpuN process 하나가 해당 GPU만 보며 model과 모든 stream cache를 소유한다.
2. realtime-agent@gpuN process 하나가 같은 NUMA node에서 LiveKit worker로 등록된다.
3. AgentServer의 job child는 GPU를 직접 보지 않고 해당 runtime endpoint만 전달받는다.
4. 두 AgentServer는 같은 STT_AGENT_NAME을 사용한다.
5. runtime은 model load와 warm-up inference가 끝난 뒤에만 ready가 된다.

GPU runtime과 AgentServer를 같은 process에 넣지 않는다. LiveKit job process lifecycle과 CUDA
context lifecycle을 분리해야 model이 job 종료나 idle process 교체의 영향을 받지 않는다.

## 책임 경계

| 책임 | room job / engine client | GPU ASR runtime |
|---|---|---|
| LiveKit 연결과 instructor track | 소유 | 모름 |
| PCM normalize와 audio clock | 소유 | 입력 검증 |
| VAD와 utterance 경계 | 소유 | open/finish 수신 |
| 560 ms chunk와 input sequence | 소유 | 크기와 순서 검증 |
| model, processor, CUDA context | 모름 | 단독 소유 |
| room별 model cache | handle만 소유 | 단독 소유 |
| batch scheduling과 GPU 실행 | 모름 | 단독 소유 |
| caption sequence와 Redis publish | 소유 | text delta 반환 |
| Redis lease와 Spring lifecycle | 소유 | 모름 |
| capacity와 pressure 원본 | snapshot 소비 | 소유 |

현재 StreamingSttEngine과 run_room_job 인터페이스는 유지한다. 새
RuntimeBackedNemotronEngine이 provider adapter가 되므로 LiveKit, caption mapper와 lifecycle은
inference 방식 변경을 알 필요가 없다.

## audio와 utterance 경계

현재 VadSegmenter는 silence 500 ms 또는 최대 8초까지 PCM 전체를 모은 뒤 segment를 반환한다.
이를 그대로 API batch에 넣으면 처리량만 좋아지고 자막 지연은 유지된다.

장기 구현은 같은 20 ms VAD frame 정책을 사용하는 StreamingVadChunker를 둔다.

1. speech 감지 시 200 ms preroll과 함께 OpenUtterance를 만든다.
2. speech가 이어지는 동안 560 ms 고정 PCM chunk를 순서대로 보낸다.
3. silence close, 8초 안전 경계 또는 room 종료 시 마지막 chunk를 padding하고
   FinishUtterance를 보낸다.
4. utterance 종료 시 runtime이 cache를 해제한다. 강의 전체를 하나의 RNNT decoder session으로
   유지하지 않는다.
5. padding 구간의 실제 길이와 audioEndMs를 함께 보내 출력 시간이 실제 audio clock을 넘지 않게 한다.

560 ms는 현재 num_lookahead_tokens=6 설정의 시작값이다. latency profile이 바뀌면 chunk shape와
capacity 근거도 달라지므로 hot change가 아니라 runtime 재시작으로 적용한다.

## local runtime API

첫 구현은 Protocol Buffers 기반 bidirectional gRPC를 권장한다. 같은 host에서는 Unix domain socket을
우선 사용하고, 배포 환경상 지원되지 않으면 loopback TCP를 쓸 수 있게 endpoint를 설정으로 둔다.
UDS file permission은 0660으로 제한한다. shared memory는 profiling이 필요성을 증명하기 전에는
추가하지 않는다.

gRPC와 protobuf는 lockfile의 전이 의존성에 기대지 않고 채택 시 direct dependency로 명시한다.
.proto가 process 사이 계약의 SSOT이며 generated code를 직접 수정하지 않는다.
[gRPC concepts](https://github.com/grpc/grpc/blob/master/CONCEPTS.md) ·
[Python quickstart](https://grpc.io/docs/languages/python/quickstart/)

하나의 room job은 하나의 bidirectional stream을 열고 다음 event를 교환한다.

### client에서 runtime으로

- OpenSession: stream ID, language, sample rate, model revision, lookahead, client instance ID
- OpenUtterance: utterance ID와 시작 audio clock
- AudioChunk: session epoch, utterance ID, 단조 증가 input sequence, PCM16, 실제 start/end,
  first/steady/final phase
- FinishUtterance: 마지막 input sequence와 실제 audio end
- CloseSession: 정상 종료의 마지막 sequence
- AbortSession: job 취소 또는 room failure

### runtime에서 client로

- SessionOpened: runtime instance ID와 새 session epoch
- ChunkAccepted: bounded queue가 수락한 마지막 input sequence
- TranscriptDelta: utterance ID, output sequence, 원인 input sequence, audioEndMs, text
- UtteranceCompleted와 SessionCompleted
- RuntimePressure: queue age, available session slot과 권고 backoff
- RuntimeError: 안정된 error code, retryable 여부, 마지막 accepted sequence

session epoch가 다른 message와 sequence gap은 즉시 거절한다. 첫 버전은 runtime 재시작 후 cache
resume을 지원하지 않는다. reconnect만으로 audio를 재전송하면 append-only caption이 중복될 수
있으므로 UNAVAILABLE은 해당 STT session의 terminal failure로 처리한다.

RPC flow control만 믿지 않고 client의 unacknowledged chunk를 room당 최대 2개로 제한한다. runtime도
room당 ready 2개와 global 2 x admittedRooms를 넘는 queue를 허용하지 않는다. 제한이 지속되면
일부 audio를 버리지 않고 stream 전체를 OVERLOADED로 실패시킨다.

## API 전환 시 load balancing

### 현재 두 GPU 한 서버

현재 규모에는 별도 nginx나 generic gRPC round-robin proxy를 두지 않는다. RNNT cache가 GPU memory에
있으므로 audio chunk마다 backend를 바꾸는 load balancing은 불가능하다.

권장 경로는 LiveKit worker와 GPU runtime을 묶은 paired topology다. self-host LiveKit은
load가 threshold 미만인 가용 AgentServer들 사이에서 job을 round-robin으로 단일 할당한다.
load 값은 가용 여부를 결정하며 최소 load worker를 직접 고르는 weight가 아니다.
[LiveKit self-host load balancing](https://docs.livekit.io/deploy/custom/deployments/#load-balancing) ·
[LiveKit AgentServer load](https://docs.livekit.io/agents/server/options/#agent-server-load)

1. AgentServer 0은 runtime 0에, AgentServer 1은 runtime 1에 고정한다.
2. 두 AgentServer를 같은 agent name으로 등록한다.
3. 각 worker는 연결된 runtime의 active/reserved session, oldest queue age, inference p95와
   readiness를 load 값에 반영해 포화되거나 비정상인 worker를 unavailable로 만든다.
4. LiveKit은 남은 가용 worker들에 round-robin으로 dispatch한다. 할당된 room의 API stream은
   선택된 GPU에 끝까지 고정된다.
5. GPU당 max session에 도달하면 그 worker load는 1.0이 된다. 두 GPU가 모두 차면 dispatch를
   pending 처리하고 Spring timeout으로 정리한다.

이 구조는 LiveKit dispatch와 ASR API 양쪽에 별도 load balancing 결정을 두지 않아 이중 예약과
GPU 간 NUMA 왕복을 피한다.

동일한 H200과 동일 cap을 가진 paired unit에는 round-robin이 충분하다. 한쪽 runtime의 queue age나
latency가 한계를 넘으면 그 worker가 unavailable이 되어 다음 job은 다른 worker로만 간다. 두 worker가
모두 threshold 아래일 때 더 낮은 pressure를 고르는 기능은 기대하지 않는다.

### 동일한 GPU 서버를 늘릴 때

동일한 GPU와 model 설정을 가진 서버는 AgentServer와 runtime의 pair를 GPU마다 하나씩 추가하고
같은 agent name으로 등록한다. 이 경우에도 LiveKit round-robin과 worker availability만 사용한다.
ASR gateway를 추가하지 않아 session admission의 owner를 하나로 유지한다.

### 독립 API pool 또는 이기종 GPU로 확장할 때

AgentServer와 runtime을 독립적으로 scale하거나, LiveKit 밖의 consumer도 ASR API를 사용하거나,
GPU별 capacity가 달라질 때만 session-aware ASR gateway를 둔다.

~~~mermaid
flowchart LR
  J[room job] -->|OpenSession + bidi stream| G[ASR session gateway]
  G -->|reservation + pinned stream| R0[GPU runtime 0]
  G -->|reservation + pinned stream| R1[GPU runtime 1]
  G -->|reservation + pinned stream| RN[GPU runtime N]
~~~

gateway는 stateless HTTP round-robin이 아니라 session router다.

1. ready이고 model revision, language, lookahead가 맞는 runtime만 후보로 남긴다.
2. 각 후보에 대해 normalized session load, oldest queue age, inference p95의 최댓값을 score로 쓴다.
3. score가 가장 낮은 runtime에 TTL이 짧은 reservation token을 atomic하게 요청한다.
4. 성공한 backend에 bidirectional stream을 pinning하고 CloseSession까지 바꾸지 않는다.
5. reservation race로 거절되면 다른 healthy 후보를 한 번만 시도하고, 모두 차면 OVERLOADED를
   반환한다.

권장 score는 다음과 같다.

~~~text
score = max(
  (activeSessions + reservedSessions) / maxSessions,
  oldestReadyAgeMs / overloadAgeMs,
  inferenceP95Ms / latencyBudgetMs
)
~~~

단순 least-connection은 room마다 발화량이 달라 GPU pressure를 반영하지 못하고, stream ID hash만
쓰면 안정적이지만 한 GPU가 포화돼도 재배치하지 못한다. 첫 session 선택은 capacity score와 atomic
reservation으로 하고, 선택 이후에만 강한 affinity를 적용한다.

gateway mode에서는 GPU 선택 권한을 gateway 한 곳에만 둔다. AgentServer의 load와 gateway score가
각각 GPU를 선택하게 하지 않는다. Spring이 LiveKit dispatch를 만들기 전에 gateway의
ReserveSession을 호출하고, 반환된 opaque reservation token을 dispatch metadata에 넣는 흐름이 가장
강한 admission을 제공한다.

1. Spring이 session ID와 model profile로 ReserveSession을 요청한다.
2. gateway가 runtime 하나에 TTL reservation을 만들고 backend를 숨긴 token을 반환한다.
3. Spring이 token을 포함해 explicit LiveKit dispatch를 생성한다.
4. 어떤 AgentServer가 job을 받아도 token을 한 번만 consume해 이미 선택된 runtime에 연결한다.
5. assignment timeout, job failure 또는 token expiry 시 reservation을 해제한다.

이 흐름은 Spring과 Python 사이 새 wire 계약이므로 실제 도입 시 docs/CONTRACT.md, 양쪽 DTO와
contract test를 함께 바꿔야 한다. Spring 선예약 없이 job 시작 후 OpenSession에서 선택하는
방식도 가능하지만, dispatch가 성공한 뒤 OVERLOADED로 실패할 수 있으므로 임시 단계로만 허용한다.

gateway 자체를 두 개 이상 띄울 때는 앞단 L4/gRPC round-robin이 어느 gateway를 선택해도 된다.
backend reservation이 atomic하므로 gateway는 session directory를 영구 저장할 필요가 없고, 열린
bidirectional connection이 affinity를 유지한다. gateway 장애는 그 connection의 terminal failure다.

중간 failover는 투명하게 하지 않는다. runtime이나 gateway가 죽으면 새 GPU에서 새 sttSessionId로
다시 시작한다. 무중단 failover를 원한다면 audio replay buffer, stable transcript checkpoint와
cache 복제라는 별도 설계가 필요하다.

## stateful batch scheduler

runtime의 utterance state는 다음을 가진다.

- session epoch, utterance ID, 다음 input/output sequence
- feature extraction offset와 실제 audio end
- encoder attention K/V cache
- subsampling과 conformer convolution padding cache
- RNNT decoder hidden/cell cache와 마지막 token
- ready, in-flight, finishing 상태와 monotonic deadline

### batch 형성

1. first chunk와 steady/final chunk는 mel shape가 다르므로 별도 ready queue로 둔다.
2. 같은 model revision, dtype, lookahead와 chunk phase만 batch로 묶는다.
3. 한 room에서 하나의 chunk만 in-flight로 두어 cache 순서를 보장한다.
4. 첫 ready 시각부터 최대 20 ms만 기다린다. max batch 도달 또는 가장 오래된 deadline이
   먼저 오면 즉시 실행한다.
5. earliest-deadline-first를 기본으로 하고 같은 deadline bucket 안에서는 round-robin으로
   room starvation을 막는다.
6. silence room은 ready queue에 없지만 admission slot은 계속 하나를 차지한다.

20 ms는 시작값이다. batch wait, feature, H2D, inference와 decode를 합친 p95가 chunk 생산 주기의
70% 이하여야 하며 batch 크기를 키우려고 deadline을 넘기지 않는다.

### model 실행

현재 Transformers generate는 호출 전체의 mutable state를 model에 두므로 사용하지 않는다.
runtime adapter가 다음 loop를 소유한다.

1. 선택한 stream의 cache tensor를 batch dimension으로 pack한다.
2. PCM을 batch feature extraction하고 고정 shape mel tensor를 만든다.
3. get_audio_features에 packed encoder와 padding cache를 명시적으로 전달한다.
4. RNNT greedy decode를 batch mask와 함께 실행한다.
5. 갱신 cache를 stream별로 scatter하고 새 token만 TranscriptDelta로 만든다.
6. final chunk의 유효 frame 뒤 token을 버리고 utterance state를 해제한다.

upstream cache class를 monkey patch하거나 site-packages를 수정하지 않는다. pack/unpack과 greedy
decode adapter는 고정 Transformers version에 대한 integration test를 가진 우리 코드로 둔다.
BF16, torch.compile과 CUDA Graph는 FP32 stateful batch가 정확히 동작한 뒤 별도 최적화한다.

## admission과 overload

runtime은 maxSessions와 함께 다음 pressure snapshot을 제공한다.

- ready 여부와 runtime instance ID
- active와 reserved session 수
- ready와 in-flight chunk 수
- oldest ready age와 최근 chunk inference p95
- GPU busy ratio, VRAM과 최근 CUDA error

AgentServer main은 background watcher로 snapshot을 갱신한다. synchronous load function은 session
load, queue age, inference latency의 normalized 최댓값을 사용한다. runtime이 unready이거나 snapshot이
stale이면 load는 1.0이다.

dispatch 수락과 OpenSession 사이 race는 runtime reservation token으로 막는다. token은 짧은 TTL
안에 session으로 전환해야 하며, token이 없으면 worker는 job을 정상 시작한 것으로 보고하지 않는다.

shared runtime 첫 배포의 maxSessions는 실측값인 GPU당 12로 유지한다. batch 처리율이 좋아져도
Korean live gate 전에는 올리지 않는다.

## 장애와 종료

- runtime이 죽으면 해당 GPU의 in-memory cache가 사라진다. room job은 PROVIDER_UNAVAILABLE terminal
  failure를 Spring에 보고하고 Redis lease를 정리한다.
- 다른 GPU로 자동 failover하지 않는다. 새 dispatch는 새 sttSessionId로 시작한다.
- supervisor는 model reload와 warm-up 후 ready를 연다. 재시작 중 worker load는 1.0이다.
- 정상 종료는 FinishUtterance, SessionCompleted, CloseSession 순서로 drain한다.
- 기존 absolute shutdown deadline을 넘으면 AbortSession을 보내고 job cleanup을 계속한다.
- client connection이 끊긴 state는 orphan session TTL로 회수한다.

GPU 한 장의 runtime 장애가 여러 room에 영향을 주는 failure fan-out은 shared model의 비용이다.
이를 GPU별 process 격리, bounded restart와 terminal callback으로 명시적으로 다룬다.

## 관측성

GPU별로 다음 metric을 수집한다.

- admitted, reserved, active, finishing session
- ready queue depth, oldest ready age, room별 unacked chunk
- batch size histogram과 first, steady, final batch 비율
- feature, batch wait, H2D, encoder, RNNT decode, end-to-delta latency
- deadline miss, overload rejection, sequence error, orphan cleanup
- cache bytes/session, model VRAM, CUDA allocated/reserved, GPU utilization과 power
- runtime별 load score와 load balancing 선택 및 reservation 실패

log에는 PCM과 transcript 원문을 기본 기록하지 않는다. stream ID, utterance ID, sequence, duration,
runtime ID, batch size와 latency만 구조화해 남긴다.

## 단계별 이행

### 단계 0: 두 GPU 격리 worker

ADR-0026대로 CUDA_VISIBLE_DEVICES와 NUMA를 분리한 AgentServer 두 개를 실행한다. 현행 guard가
유지되는 동안 worker당 1 room이므로 두 GPU를 써도 총 2 room이다. 이후 격리 warm pool을
GPU당 12까지 연다.

### 단계 1: runtime API 경계만 분리

GPU마다 model 한 벌의 runtime과 RuntimeBackedNemotronEngine을 만든다. 처음에는 runtime당
한 session만 허용하고 기존 완성 VAD segment를 보내 protocol, lifecycle, cancellation과 runtime
crash를 검증한다.

### 단계 2: completed-segment dynamic batch

여러 session의 완성 segment를 20 ms window로 batch한다. 이는 scheduler, admission, metric과
model 한 벌의 안정성을 검증하는 spike이며 자막 latency 개선 단계가 아니다.

### 단계 3: stateful 560 ms chunk batch

StreamingVadChunker, explicit cache adapter와 batched RNNT decode를 도입한다. 동일 audio corpus로
기존 provider와 append-only delta, final transcript, audioEndMs와 Korean CER를 비교한다.

### 단계 4: GPU 한 장 canary

기존 worker와 shared runtime worker에 서로 다른 agent name을 주고 명시적 dispatch로 일부
비민감 session만 canary에 보낸다. 같은 room을 두 provider에 동시에 publish하지 않는다.

### 단계 5: cap 승격

두 GPU 모두 shared runtime으로 전환하되 처음에는 12 room/GPU를 유지한다. 16, 24, 32 room/GPU
순서로 burst와 30분 soak를 통과한 값까지만 cap을 올린다.

## 검증 gate

1. cache 격리: 교차 패턴 audio를 batch해 room 간 token/cache 오염 0
2. ordering: duplicate, gap, stale epoch, late delta를 contract test에서 모두 거절
3. backpressure: 모든 room 동시 발화에서 queue 상한 유지와 임의 audio drop 0
4. latency: 0.3, 1, 2, 8초 Korean 혼합 입력의 end-to-delta p95가 budget 이내
5. 정확도: single-room FP32 baseline 대비 Korean CER가 합의 범위 이내
6. lifecycle: finish, cancel, room delete, client kill, runtime kill에서 cache와 lease 회수
7. capacity: 두 GPU NUMA 고정 30분 soak에서 backlog 증가, CUDA error, OOM 0
8. load balancing: 동시 OpenSession burst에서 이중 reservation과 maxSessions 초과 0
9. 관측: runtime 선택, batch, queue age와 failure가 dashboard에서 추적 가능

## 대안

| 대안 | 판단 |
|---|---|
| 한 process가 두 H200을 device_map=auto로 사용 | room 배치, NUMA, 장애 경계가 불명확해 기각 |
| 방별 model process 계속 증설 | 단기에는 사용하지만 처리율 포화와 model 복제로 장기 기각 |
| shared model에 Python lock | inference가 직렬화돼 기각 |
| 현재 generate를 여러 thread에서 호출 | model mutable state 충돌로 기각 |
| VAD 완성 segment만 dynamic batch | scheduler spike로만 허용 |
| nginx round-robin으로 audio 요청 분산 | stateful cache affinity를 깨므로 기각 |
| Redis나 RabbitMQ audio transport | 실시간 deadline과 backpressure를 흐려 기각 |
| shared memory 또는 CUDA IPC | 현재 PCM 대역폭에는 과도해 profiling 전 기각 |
| GPU별 local stateful batch runtime | 목표 구조로 제안 |

## 영향과 계약·테스트 판단

이 문서는 장기 구조 제안만 추가하고 실행 코드, API payload, Redis caption entry와 HTTP 상태코드를
바꾸지 않는다. 따라서 현재 docs/CONTRACT.md나 공유 계약 테스트 변경은 필요하지 않다.

구현 시 local runtime도 독립 process 계약이므로 .proto, error code, ordering과 shutdown semantics를
ai/realtime-agent/contracts에 추가하고 contract test를 먼저 만든다. StreamingSttEngine adapter
단위 테스트, cache pack/scatter golden test, fake runtime integration, GPU E2E와 dual-GPU capacity
test를 단계별 완료 gate로 둔다.

UDS gRPC 지원, final chunk padding의 token 억제와 Transformers cache pack/scatter는 단계 1과 3에서
spike로 먼저 검증한다. 하나라도 안정적으로 구현되지 않으면 shared runtime을 production 경로로
승격하지 않는다.
