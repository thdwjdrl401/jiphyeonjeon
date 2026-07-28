# ADR-0028: STT provider는 engine adapter와 process 실행 profile을 함께 등록

- **상태**: 채택
- **일자**: 2026-07-28
- **관련**: [ADR-0012](0012-realtime-stt-provider-and-overload-boundary.md),
  [ADR-0026](0026-realtime-stt-concurrency-and-batching.md),
  [ADR-0027](0027-realtime-stt-shared-gpu-runtime.md)

## 맥락

realtime-agent의 StreamingSttEngine과 registry는 local Nemotron, OpenAI Realtime API와 stub을
같은 job 경계에서 교체할 수 있다. 그러나 AgentServer 실행 정책은 provider와 분리돼 있지 않다.
현재 main은 모든 provider에 idle process 1개를 사용하고, config는 Nemotron만 이름으로 검사해
STT_MAX_ACTIVE_JOBS=1을 강제한다.

Nemotron을 한 H200에서 12 room까지 열려면 job process마다 독립 model을 미리 적재해야 한다.
반면 외부 API provider는 GPU model prewarm이 필요 없다. 단순히 전역 idle process를 12로 바꾸면
API provider까지 같은 정책을 사용하고, local provider는 최대 부하에서 12 active와 12 idle model,
총 24벌을 유지한다. 동시 room cap과 warm 여유분은 별도 설정이어야 한다.

## 결정

### provider definition

registry의 provider 등록 단위를 engine factory 하나에서 다음 provider definition으로 확장한다.

- 이름과 lazy engine factory
- provider execution profile
- 선택적인 process resource prewarm factory
- prewarmed resource를 받는 engine factory

execution profile은 다음 내부 정책을 가진다.

- provider 기본 max active job 수와 검증된 상한
- provider 기본 idle process 수
- process initialization timeout
- job process memory advisory warning threshold
- process resource prewarm 사용 여부

AgentServer와 config core는 nemotron 같은 provider 이름으로 분기하지 않는다. 선택한 provider
definition의 profile을 조회해 max active job을 검증하고 pool options를 만든다. 새 local model이나
외부 API를 추가할 때 registration이 자기 실행 profile을 선언한다.

### process resource 수명주기

LiveKit setup hook은 job child 안에서 provider resource를 만든 뒤 JobProcess userdata에 저장한다.
job entrypoint는 registry를 통해 resource를 정확히 한 번 꺼내 engine에 소유권을 넘긴다.

- Nemotron resource는 model을 이미 load한 recognizer다.
- Nemotron engine이 job 종료 시 recognizer를 close한다.
- resource가 필요한 provider의 job에서 userdata가 비어 있으면 cold-load로 숨기지 않고 실패한다.
- 직접 engine을 만드는 단위 테스트와 개발 용도는 process resource 없이 기존 lazy factory를
  사용할 수 있다.
- OpenAI Realtime과 stub은 process resource가 없으며 기존 job별 engine 생성을 유지한다.

모델 객체를 parent process에서 만든 뒤 fork하지 않는다. CUDA context는 setup hook이 실행되는
각 job child에서 생성한다.

### capacity와 warm pool

설정을 다음처럼 분리한다.

- STT_MAX_ACTIVE_JOBS: worker가 동시에 수락할 room 수. 없으면 provider profile 기본값
- STT_NUM_IDLE_PROCESSES: job을 기다리며 미리 준비할 process 수

STT_NUM_IDLE_PROCESSES가 없으면 provider profile 기본값을 사용한다. 값은 1 이상이고
STT_MAX_ACTIVE_JOBS 이하여야 한다.

Nemotron profile은 ADR-0026 측정을 근거로 다음 값을 사용한다.

- max active job 기본값과 상한 12
- 기본 idle process 12
- process initialization timeout 120초
- job process memory warning 2304 MB

LiveKit Agents 1.6.6은 active job이 아직 없는 동안 `load_threshold / num_idle_processes`를 예약
slot 하나의 추정 load로 쓴다. idle 2인 worker에 12개 dispatch를 한꺼번에 보낸 실측에서는 request
interleaving 중 10개만 배정되고 2개가 `worker not available`로 거절됐다. LiveKit Server 1.13.3은
이 explicit dispatch를 worker가 다시 available이 된 뒤 자동 재시도하지 않았다. 따라서 시작 직후
12-request burst를 보장하려면 Nemotron의 active cap과 idle 기본값을 모두 12로 둔다.

시작 시 warm model 12벌은 process당 2952 MiB, 합계 35,503 MiB를 사용했다. active 12 상태에서 SDK가
replacement idle 12벌을 채워 최대 24 model이 상주했고, 12개 동시 추론 중 GPU 0 peak는 81,468 MiB였다.
job RSS는 약 1.94–1.97 GiB로 측정돼 advisory warning을 2304 MiB로 둔다. H200 NVL 143,771 MiB에는
들어가지만 장기 soak와 더 긴 utterance의 KV/cache peak는 별도 headroom으로 검증해야 한다.

OpenAI Realtime과 stub profile은 기본 active job 1, 상한 100, 기본 idle process 1을 유지한다.
실제 API rate limit은 별도 provider quota/admission 기능이 생기기 전에는 운영자가
STT_MAX_ACTIVE_JOBS로 제한한다.

### load와 overload

기존 activeJobs / maxActiveJobs load 함수와 LiveKit 1.6.6의 reserved slot 계산을 유지한다.
idle process 수는 active cap을 바꾸지 않지만 시작 직후 동시 availability admission에도 영향을 준다.
12번째까지 수락하고 load 1.0에서 FULL이 되며, 13번째 Nemotron dispatch는 수락하지 않고 LiveKit
pending 및 Spring assignment timeout 경계를 따른다.

## 대안

| 대안 | 판단 |
|---|---|
| config에서 provider 이름별 if 문 추가 | 새 provider마다 core 수정이 필요해 기각 |
| 모든 provider idle process 12 | API provider 낭비와 local model 24벌 상주로 기각 |
| Nemotron model 한 벌을 job process끼리 공유 | 현재 generate mutable state와 process 경계 때문에 기각 |
| Nemotron idle process 2 | 12-request burst에서 10개만 배정되는 것을 실측해 기각 |
| idle process 1만 유지 | 동작은 가능하지만 동시 burst의 model cold-load 지연이 커 기본값으로 기각 |
| max active와 idle warm 수 분리 | 채택 |
| provider definition에 실행 profile과 resource factory 등록 | 채택 |

## 영향과 검증

- 기존 StreamingSttEngine, LiveKit dispatch metadata, Redis caption과 Spring callback wire는
  변경하지 않는다. docs/CONTRACT.md 변경과 공유 계약 테스트는 필요하지 않다.
- registry resource consume, missing prewarm fail-closed, provider profile resolution을 단위
  테스트한다.
- config는 Nemotron 12 허용, 13 거절, idle 범위와 provider별 기본값을 테스트한다.
- main은 setup hook, num idle, initialization timeout과 prewarmed engine 전달을 테스트한다.
- Python 전체 pytest와 ruff를 통과한 뒤 단일 H200에서 12 concurrent dispatch를 검증한다.

2026-07-28 구현·E2E 검증 결과는 다음과 같다.

- `CUDA_VISIBLE_DEVICES=0`, active/idle 기본값 12로 시작해 child model 12개 초기화와 worker 등록을
  확인했다. 시작 메모리는 GPU 0 35,503 MiB, GPU 1 0 MiB였다.
- strict `session-{UUID}` room 12개와 explicit dispatch 12개를 동시에 만들었고 agent participant가
  12/12 입장했다. worker는 job 12개에서 load 1.0 FULL이 됐다.
- 8초 speech를 12 room에 동시에 보낸 `en-US` 언어 일치 검증에서 모든 session이 caption delta를
  17–23개 발행했고 completion도 12/12였다. GPU 0은 SM 99–100%, peak 81,468 MiB였고 GPU 1은
  사용하지 않았다.
- 운영 기본 `ko-KR`에 영어 sample을 넣은 검증은 12개 generate와 completion을 수행했지만 delta는
  0개였다. 이는 언어 불일치 sample 결과이며 한국어 정확도 증거로 사용하지 않는다.
- room 12개를 삭제하고 worker를 정상 종료한 뒤 realtime-agent/probe process는 없고 두 GPU 모두
  0 MiB로 복귀했다.

30분 soak, 자연스러운 한국어 발화의 CER/지연, 13번째 pending과 Spring assignment timeout은 별도
운영 gate로 남는다.

장기적으로 ADR-0027의 shared stateful batch runtime을 도입하면 Nemotron registration만
process-local resource profile에서 API client profile로 교체한다. room job과 main의 provider
선택 구조는 유지한다.
