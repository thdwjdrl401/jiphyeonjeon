# ADR-0030: EC2와 GPU 배포는 host별 Runner와 rootless GPU supervisor로 연결

- **상태**: 채택
- **일자**: 2026-07-28
- **관련**: [ADR-0024](0024-realtime-agent-gpu-turn-runtime.md),
  [ADR-0025](0025-realtime-agent-spring-handoff-contract.md),
  [GPU 배포 가이드](../../../ai/realtime-agent/deploy/README.md)

## 맥락

LiveKit·Spring·Redis는 EC2에서, Nemotron realtime-agent는 별도 H200 GPU 서버에서 실행한다.
Worker 등록은 agent process의 WebSocket 연결 상태이므로 LiveKit에 미리 저장할 수 없다. GPU 서버는
EC2와 GitLab로 outbound 연결할 수 있지만 inbound는 닫혀 있다.

제공받은 Jupyter 계정에는 sudo 권한이 없고 jupyter-liveclass.service의 NoNewPrivileges=yes 때문에
setuid helper와 사용자 crontab도 사용할 수 없다. 따라서 system-wide GitLab Runner, systemd unit,
sudoers를 설치하는 설계는 실행 불가능하다.

## 결정

GPU 서버에 프로젝트 전용 GitLab shell Runner binary를 사용자 홈에 설치하고 gpu-realtime tag로
고정한다. Runner와 runtime supervisor는 같은 계정의 tmux session에서 실행한다.

- ec2-liveclass Runner는 application과 LiveKit을 배포한다.
- gpu-realtime Runner는 EC2 application deploy 성공 뒤 realtime-agent를 배포한다.
- DEPLOY_ALL=1이면 GPU job이 application·LiveKit 양쪽을 기다린다.
- Runner는 project locked, protected, tagged-only, concurrency 1로 제한한다.
- bootstrap 전에는 GPU_DEPLOY_ENABLED를 비워 GPU job을 제외한다.

release, cache, 시크릿 설정, helper는 각각 ~/.local/share, ~/.config, ~/.local/bin 아래에 둔다.
배포 helper는 source를 commit SHA별 release로 복사하고 frozen Nemotron dependency와 CUDA smoke를
통과시킨 뒤 current symlink를 교체한다. health 실패 시 이전 release로 rollback한다.

tmux supervisor는 tunnel watcher와 agent를 별도 session으로 관리한다. tunnel watcher는 기존 SSH
control master를 재사용하고, 끊어지면 다시 연결한다. SSH 연결은 LiveKit·Redis·TURN local forward와
GPU health의 EC2 loopback reverse forward를 함께 제공한다. LIVEKIT_URL의 TLS hostname은
source-controlled LD_PRELOAD resolver로 해당 hostname만 loopback에 매핑한다.

운영 bootstrap은 전달받은 PEM을 Git 밖의 `~/.config/liveclass/ssh/`에 `0600`으로 복사하고,
realtime-agent와 BGE tunnel env에 같은 key·EC2 target을 기록한다. 두 서비스는 장애 격리를 위해 별도
SSH connection과 supervisor를 유지한다. realtime-agent tunnel은 LiveKit·application Redis·TURN과
agent health를, BGE tunnel은 local runtime readiness 이후 embedding reverse forward를 담당한다.
모든 reverse listener는 EC2 loopback에만 bind하며 private key 파일은 `*.pem` ignore로 보호한다.

## 제약

tmux는 terminal과 브라우저 disconnect에는 살아남지만 GPU host 또는 Jupyter service restart에는
살아남지 못한다. sudo, user systemd bus, linger, 사용 가능한 crontab이 모두 없으므로 boot-time
자동 시작은 구현할 수 없다. 재시작 후 사용자가 Runner 시작 명령을 한 번 실행하면 pipeline이
tunnel과 agent를 복구한다. 실행 계정이 release도 소유하므로 root-owned immutable 경계는 없다.

## 대안

| 대안 | 판단 |
|---|---|
| EC2 Runner가 GPU로 SSH 배포 | GPU inbound와 배포 key가 필요해 기각 |
| system Runner + systemd + sudo helper | 계정 권한으로 설치 불가능해 기각 |
| user systemd 또는 cron @reboot | user bus·linger가 없고 crontab setgid가 차단돼 기각 |
| Docker Compose/Kubernetes/Nomad | rootless runtime이 없고 현재 규모에 과도해 기각 |
| 사용자 Runner + tmux supervisor | 현재 권한에서 outbound-only 연계가 가능해 채택 |

## 영향과 테스트 판단

- MR에서 realtime-agent unit test, Ruff와 wheel build를 CPU container로 검증한다.
- helper의 shell syntax, 입력 검증, release/rollback 순서, sudo/systemd 부재를 테스트한다.
- DNS redirect C source는 -Wall -Wextra -Werror로 빌드한다.
- 운영 bootstrap이 PEM을 Git 밖에 0600으로 설치하고 두 서비스 설정에 동일 경로·target을 쓰는지
  회귀 테스트한다.
- 실제 GPU gate는 frozen Nemotron sync, CUDA availability와 LiveKit agent health다.
- API, Redis entry, callback payload와 상태코드를 바꾸지 않아 공유 계약 테스트는 불필요하다.
- Runner authentication token은 저장소로 자동화하지 않는 일회성 외부 설정이다.
