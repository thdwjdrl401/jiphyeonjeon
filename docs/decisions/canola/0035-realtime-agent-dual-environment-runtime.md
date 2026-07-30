# ADR-0035: 단일 GPU에서 dev/prod realtime-agent를 분리 실행

- **상태**: 채택
- **일자**: 2026-07-30
- **관련**: [ADR-0028](0028-stt-provider-execution-profile-and-warm-pool.md),
  [ADR-0030](0030-cross-host-realtime-agent-deployment.md),
  [ADR-0032](0032-realtime-agent-service-health-contract.md),
  [ADR-0033](0033-realtime-agent-ssh-channel-isolation.md),
  [GPU realtime-agent runbook](../../ai/GPU-REALTIME-AGENT-RUNBOOK.md)

## 맥락

EC2에는 개발용 application Redis(host `:4000`, password)와 운영용 application Redis(loopback
`:6390`, 무인증)가 따로 있다. 반면 GPU에는 realtime-agent process가 하나뿐이라 한 시점에 한 환경의
caption stream만 사용할 수 있었다. 환경을 전환할 때 env와 process를 수동으로 바꾸면 개발 E2E와 운영
배포를 동시에 지원할 수 없고 잘못된 Redis에 자막을 쓸 위험이 있다.

두 process가 같은 LiveKit과 같은 `STT_AGENT_NAME`을 쓰는 것도 안전하지 않다. LiveKit은 같은 이름의
가용 Worker 중 하나에 explicit dispatch를 배정하므로 운영 dispatch가 개발 Redis에 연결된 Worker로 갈
수 있다. health port와 tmux session도 하나면 두 process를 동시에 관리할 수 없다.

물리 GPU는 GPU 0 하나만 사용해야 한다. 검증된 운영 profile `active/idle=12/12`의 12개 동시 추론
peak는 81,468 MiB였으므로 dev에도 같은 12-process warm pool을 추가하면 불필요하게 메모리를 예약하고
동시 peak 안전 여유를 줄인다.

## 결정

같은 코드 release와 GPU 0에서 dev/prod realtime-agent를 별도 process로 항상 실행한다.

| 항목 | dev | prod |
|---|---|---|
| env | `~/.config/liveclass/realtime-agent-dev.env` | `~/.config/liveclass/realtime-agent.env` |
| tmux session | `liveclass-realtime-agent-dev` | `liveclass-realtime-agent-prod` |
| `STT_AGENT_NAME` | `liveclass-realtime-stt` | `liveclass-realtime-stt-prod` |
| Redis tunnel | `127.0.0.1:4000` | `127.0.0.1:6390` |
| GPU health | `127.0.0.1:8082` | `127.0.0.1:8081` |
| EC2 reverse health | `127.0.0.1:18082` | `127.0.0.1:18081` |
| active/idle 기본값 | `1/1` | `12/12` |

두 process는 LiveKit `:7443`, TURN/TCP `:3478`, model 경로와 `CUDA_VISIBLE_DEVICES=0`을 공유한다.
환경 격리는 named Worker pool과 Redis로 수행한다. prod Spring Compose의 기본
`LIVEKIT_AGENT_NAME`은 `liveclass-realtime-stt-prod`로 고정하고, dev Spring의 기존 기본값
`liveclass-realtime-stt`는 유지한다.

realtime control SSH connection은 LiveKit, dev/prod Redis local forward, dev/prod health reverse
forward를 함께 가진다. TURN과 BGE connection은 ADR-0033의 장애 격리를 그대로 유지한다. 모든 reverse
listener는 EC2 loopback에만 bind하며 GPU/EC2 application inbound port를 새로 공개하지 않는다.

배포 supervisor는 레거시 단일 session을 정리하고 dev/prod session을 모두 시작한다. 배포 성공은 두
process status와 두 readiness가 모두 통과해야 한다. 실패하면 새 release의 두 process를 먼저 정리한 뒤
이전 release로 rollback한다. 사용자 홈의 deploy/supervisor 명령은 두 readiness 성공 뒤에만 최신
release로 교체한다.

## 대안

| 대안 | 판단 |
|---|---|
| env를 바꿔 단일 process를 개발/운영 사이에서 전환 | 동시 지원이 안 되고 수동 전환 실수 위험이 있어 기각 |
| 두 process가 같은 agent name 사용 | LiveKit 배정이 환경 Redis 경계를 보장하지 않아 기각 |
| dev와 prod 모두 `12/12` 사용 | 한 GPU에서 불필요한 warm pool과 동시 peak 위험을 키워 기각 |
| 두 번째 GPU 사용 | 현재 GPU 하나만 사용한다는 운영 제한에 어긋나 기각 |
| GPU 또는 EC2에 새 public inbound port 개방 | 기존 outbound SSH/loopback 구조로 해결 가능해 기각 |

## 영향과 검증

- 운영 capacity `12/12`는 유지하고 dev는 기본 `1/1`이라 개발 동시 dispatch는 한 개로 제한된다.
- 두 환경이 같은 model 파일과 GPU compute를 공유하므로 dev 추론은 운영 workload의 지연에 영향을 줄 수
  있다. 운영 우선순위가 필요해지면 dev process stop 또는 별도 scheduling 정책을 후속으로 도입한다.
- shell 회귀 테스트는 두 Redis forward, 두 loopback health reverse, 별도 env/session/name/port,
  배포의 양쪽 readiness와 rollback 순서를 검증한다.
- 공유 API JSON field, HTTP status 의미, dispatch metadata와 Redis entry schema는 바꾸지 않는다.
  구성 계약은 env example·Compose·운영 script 테스트로 고정한다.
- 실제 GPU의 두 model pool 동시 기동과 EC2 양쪽 health smoke는 이 변경이 master에 병합되어 배포된 뒤
  운영 검증한다. 병합 전에는 완료 증거로 간주하지 않는다.
