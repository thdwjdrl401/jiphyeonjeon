# ADR-0030: EC2와 GPU 배포는 host별 GitLab Runner와 systemd로 연결

- **상태**: 채택
- **일자**: 2026-07-28
- **관련**: [ADR-0024](0024-realtime-agent-gpu-turn-runtime.md),
  [ADR-0025](0025-realtime-agent-spring-handoff-contract.md),
  [GPU 배포 가이드](../../../ai/realtime-agent/deploy/README.md)

## 맥락

LiveKit·Spring·Redis는 EC2에서, Nemotron realtime-agent는 별도 H200 GPU 서버에서 실행한다. 현재
GitLab pipeline은 EC2의 self-hosted shell runner만 사용하고 GPU agent는 사람이 clone, tunnel,
process 시작을 각각 수행한다. LiveKit Worker 등록은 영구 설정이 아니라 agent process의 WebSocket
연결 상태이므로 LiveKit compose에 agent 정보를 미리 저장해도 이 운영 절차를 대체하지 못한다.

두 서버를 매 배포마다 동시에 재시작할 필요는 없지만, 전체 배포와 agent 변경 배포 모두 단일 pipeline
상태로 성공·실패를 확인해야 한다. GPU 서버는 EC2에 SSH outbound가 가능하지만 EC2에서 GPU로 inbound
배포 연결을 여는 것은 네트워크·key 관리 부담이 크다.

## 결정

GPU 서버에 이 프로젝트 전용 GitLab shell runner를 설치하고 `gpu-realtime` tag로 고정한다. GitLab
pipeline이 host별 job을 조정하고 각 runner는 자기 host에서만 배포한다.

- 기존 `ec2-liveclass` runner는 application과 LiveKit을 배포한다.
- `gpu-realtime` runner는 EC2 application deploy 성공 뒤 realtime-agent를 배포한다.
- `DEPLOY_ALL=1`이면 LiveKit 수동 gate를 자동으로 열고 GPU job이 application·LiveKit 양쪽을 기다린다.
- 일반 agent 변경은 LiveKit을 재시작하지 않고 GPU release만 교체한다.
- runner는 project locked, protected, tagged-only, concurrency 1로 제한한다.
- runner와 host bootstrap 전에는 `GPU_DEPLOY_ENABLED`를 비워 GPU job을 pipeline에서 제외한다.

GPU host process는 systemd 두 unit으로 분리한다.

1. tunnel service는 ssh를 foreground로 유지하고 실패하면 재시작한다.
2. agent service는 tunnel 이후 시작하며 실패하면 재시작한다.

배포는 GitLab checkout 자체에서 장기 process를 실행하지 않는다. root-owned helper가 source를 commit
SHA별 release로 복사하고 frozen Nemotron dependency와 CUDA smoke를 먼저 통과시킨 뒤 `current` symlink를
교체한다. 검증이 끝난 release는 root 소유로 바꿔 실행 중 agent가 코드를 수정하지 못하게 한다.
agent health가 실패하면 이전 release로 rollback한다. 시크릿, SSH key와 model checkpoint는
release 외부의 host 파일로 유지한다.

LiveKit production `start`의 host-local health endpoint를 등록 완료 gate로 사용한다. 무중단 배포는
요구하지 않으며 systemd는 SIGTERM drain을 최대 300초 기다린다.

## 대안

| 대안 | 판단 |
|---|---|
| EC2 runner가 GPU로 SSH 배포 | GPU inbound와 배포 key 관리가 추가돼 기각 |
| 한 compose가 두 host를 관리 | Docker Compose는 cross-host scheduler가 아니므로 기각 |
| Kubernetes/Nomad 도입 | 현재 두 host 규모에는 운영 비용이 과도해 기각 |
| GPU에서 주기적으로 Git pull | 배포 commit과 성공 상태를 pipeline이 보장하지 못해 기각 |
| host별 GitLab Runner | 기존 CI를 확장하면서 outbound 연결만 요구해 채택 |

## 영향과 테스트 판단

- MR에서 realtime-agent unit test, Ruff와 wheel build를 CPU container로 검증한다.
- 배포 helper는 shell syntax, 입력 검증, release/rollback 불변식을 테스트한다.
- systemd unit은 `systemd-analyze verify`로 검사한다.
- 실제 GPU deploy gate는 frozen Nemotron sync, CUDA availability와 LiveKit agent health다.
- API, Redis entry, callback payload와 상태코드를 바꾸지 않으므로 공유 계약 테스트 추가는 불필요하다.
- GPU project runner 등록 token은 저장소로 자동화하지 않는 일회성 외부 설정이다.
