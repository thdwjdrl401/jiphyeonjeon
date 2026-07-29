# ADR-0031: BGE runtime은 GPU0 고정 rootless release와 tmux supervisor로 배포

- **상태**: 채택
- **일자**: 2026-07-29
- **관련**: [ADR-0013](0013-bge-m3-runtime-boundary.md),
  [ADR-0029](0029-gpu-bge-ec2-ai-worker-connectivity.md),
  [ADR-0030](0030-cross-host-realtime-agent-deployment.md),
  [BGE 배포 가이드](../../../ai/bge-runtime/deploy/README.md)

## 맥락

EC2 ai-worker는 GPU 호스트의 BGE runtime을 reverse SSH tunnel로 호출한다. GPU 호스트에는 sudo,
system systemd와 사용 가능한 boot-time user service가 없으므로 root-owned unit을 설치할 수 없다.
realtime-agent와 BGE를 같은 물리 GPU 하나에서 운영해야 하며 GPU 1로 workload를 넘기면 안 된다.

수동 tmux 실행으로 실제 BGE warmup과 EC2 embedding 왕복은 검증했지만, 새 master build가 자동으로
release를 교체하거나 process·tunnel 장애를 복구하지는 않았다.

## 결정

- BGE source를 commit SHA별 `~/.local/share/liveclass/bge-runtime/releases`에 복사하고 frozen
  `cuda` extra를 설치한다.
- CUDA package smoke가 성공한 뒤에만 `current` symlink를 원자적으로 교체한다. local readiness가
  실패하면 이전 symlink와 runtime·tunnel을 복구한다.
- runtime과 reverse tunnel은 별도 tmux supervisor loop로 관리한다. terminal 종료와 child process
  crash에는 자동 복구하지만 GPU/Jupyter 재시작 뒤에는 Runner를 한 번 다시 시작해야 한다.
- supervisor와 deploy smoke는 `CUDA_VISIBLE_DEVICES=0`을 강제한다. runtime device도 `cuda`로
  덮어써 visible physical GPU0만 사용한다.
- realtime-agent와 BGE GPU deploy job은 같은 `gpu0-production` resource group과 project-locked
  `gpu-realtime` shell Runner를 사용해 직렬 실행한다.
- 시크릿 환경파일, SSH key, Hugging Face model cache는 release 밖에 두고 저장소와 job log에
  복사하지 않는다.

## 제약과 운영 조건

GitLab Runner authentication token 등록과 `GPU_DEPLOY_ENABLED=1` protected variable 설정은 GitLab
관리 권한이 필요한 일회성 bootstrap이다. 둘 중 하나가 없으면 master pipeline의 GPU job은 실행되지
않는다. tmux와 사용자 Runner는 host reboot를 넘지 못하므로 reboot 후 Runner 시작은 수동이다.

reverse tunnel은 EC2 loopback에만 bind한다. 배포 helper는 local `/readyz`와 supervisor process를
gate로 사용하고, 실제 EC2 `127.0.0.1:18020` readiness 및 인증 embedding 왕복은 원격 smoke로
확인한다.

## 대안

| 대안 | 판단 |
|---|---|
| systemd service와 system GitLab Runner | sudo와 NoNewPrivileges 제약으로 설치 불가능 |
| EC2 Runner가 GPU에 inbound SSH 배포 | GPU inbound를 열고 배포 key를 EC2에 둬야 하므로 기각 |
| BGE와 realtime-agent를 하나의 process/release로 결합 | 장애·의존성·health 경계를 묶으므로 기각 |
| GPU별 독립 CI resource group | 같은 물리 GPU에서 sync/smoke가 겹칠 수 있어 기각 |
| rootless Runner + tmux supervisor + 공유 resource group | 현재 권한과 단일 GPU 제약을 만족해 채택 |

## 테스트와 계약 판단

- shell syntax, release ID fail-closed, dependency/CUDA gate 이전 symlink 전환 금지, rollback,
  sudo/systemd 부재와 GPU0 강제를 자동 테스트한다.
- bge-runtime unit test, Ruff, format check와 wheel build를 MR gate로 실행한다.
- 실제 완료 검증은 GPU0 pinned model readiness와 EC2 reverse tunnel embedding smoke로 수행한다.
- Java/FE API payload와 상태코드를 변경하지 않는다. 기존 `docs/CONTRACT.md`의 Python 내부 BGE
  HTTP 계약도 변경하지 않으므로 FE/BE 계약 테스트는 불필요하다.
