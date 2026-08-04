# GPU realtime-agent rootless 배포

GPU 호스트는 sudo 권한이 없고 Jupyter service에 `NoNewPrivileges=yes`가 적용돼 있다. GitLab Runner,
SSH tunnel과 realtime-agent는 모두 `liveclass` 사용자 영역에서 실행한다. prod는 GPU0의 Nemotron
12-slot worker, dev는 outbound OpenAI Realtime 1-slot worker로 별도 tmux session에 유지하며 LiveKit
agent name, Redis, health port를 분리한다.

| 환경 | env file | tmux session | `STT_AGENT_NAME` | Redis | GPU health | EC2 health | 기본 용량 |
|---|---|---|---|---|---|---|---:|
| prod | `~/.config/liveclass/realtime-agent.env` | `liveclass-realtime-agent-prod` | `liveclass-realtime-stt-prod` | `127.0.0.1:6390`, 무인증 | `127.0.0.1:8081` | `127.0.0.1:18081` | 12 |
| dev | `~/.config/liveclass/realtime-agent-dev.env` | `liveclass-realtime-agent-dev` | `liveclass-realtime-stt-dev` | `127.0.0.1:4000`, requirepass | `127.0.0.1:8082` | `127.0.0.1:18082` | 1 |

두 worker가 같은 name을 쓰면 LiveKit이 prod dispatch를 dev Redis worker에 배정할 수 있으므로 이름을
합치지 않는다. prod Spring은 `LIVEKIT_AGENT_NAME=liveclass-realtime-stt-prod`, dev Spring은 기존
기본값 `liveclass-realtime-stt-dev`를 사용한다. GPU host 또는 Jupyter service가 재시작되면 사용자 process도
종료되므로 Runner와 supervisor를 다시 시작해야 한다.

## 1. 사용자 영역 bootstrap

Python 환경은 프로젝트 표준인 Python 3.12와 uv를 사용한다.

~~~sh
cd /home/liveclass/liveclass
ai/realtime-agent/deploy/install.sh /opt/tljh/user/bin/uv
ai/realtime-agent/deploy/install-gitlab-runner-user.sh latest
ai/bge-runtime/deploy/install.sh /opt/tljh/user/bin/uv
~~~

첫 명령은 실행파일을 `~/.local/bin`, release/cache를
`~/.local/share/liveclass/realtime-agent`, 환경파일을 `~/.config/liveclass`에 설치한다. 기존 환경파일은
덮어쓰지 않는다. 다음 네 파일을 실제 값으로 채우고 `0600`을 유지한다.

- `realtime-agent-common.env`: 두 worker가 공유하는 LiveKit/TURN과 명시적 운영 정책
- `realtime-agent.env`: prod worker
- `realtime-agent-dev.env`: dev worker
- `realtime-agent-tunnels.env`: 공용 LiveKit/TURN, dev/prod Redis·health SSH forward

~~~sh
chmod 600 ~/.config/liveclass/realtime-agent*.env
~~~

`LIVEKIT_URL`·TURN과 공통 정책은 `realtime-agent-common.env`에 한 번만 둔다. prod profile은
`STT_ENGINE_PROVIDER=nemotron`, `CUDA_VISIBLE_DEVICES=0`, model 경로와 `12/12` 용량을 명시한다.
dev profile은 `STT_ENGINE_PROVIDER=openai-realtime`, OpenAI key/model/delay와 `1/1` 용량만 갖고
Nemotron·CUDA 변수는 넣지 않는다. 공통 파일을 먼저, 환경 profile을 나중에 로드한다.

기존 설치 업그레이드는 **새 supervisor 배포 전에** `realtime-agent-common.env`를 먼저 만들고 실제 공통값을
옮긴 뒤 두 profile의 중복값을 지운다. 설치 스크립트는 기존 env를 덮어쓰지 않으며 새 supervisor는 공통
파일이 없으면 fail-closed한다. prod profile에는 OpenAI 변수를, dev profile에는 `ASR_MODEL_ID`와
`CUDA_VISIBLE_DEVICES`를 남기지 않는다. 파일 권한과 profile 검증을 마친 뒤 환경별
`restart-agent-prod` 또는 `restart-agent-dev`로 하나씩 전환한다.

운영 tunnel bootstrap은 전달받은 PEM을 Git 밖의 `~/.config/liveclass/ssh/`로 복사하고 realtime-agent와
BGE tunnel env를 만든다. EC2 host key는 별도 채널로 확인해 `known_hosts`에 먼저 등록한다.

~~~sh
ai/realtime-agent/deploy/configure-gpu-ec2-tunnels.sh \
  /absolute/path/to/gpu-to-ec2.pem \
  <ec2-user>@<ec2-host> \
  --start
~~~

## 2. GPU project Runner 등록

GitLab project Runner는 tag `gpu-realtime`, project lock, protected branch 전용, untagged job 비활성,
동시 실행 수 1로 등록한다. authentication token은 파일·로그·문서에 남기지 않는다.

~~~sh
~/.local/bin/gitlab-runner register \
  --config ~/.gitlab-runner/config.toml \
  --url <gitlab-url> \
  --token <runner-authentication-token> \
  --executor shell
~/.local/bin/liveclass-gitlab-runner-user start
~~~

Runner와 최초 GPU 배포가 정상임을 확인한 뒤 protected CI 변수 `GPU_DEPLOY_ENABLED=1`을 설정한다.
GPU Runner는 GitLab와 EC2로 outbound 연결만 사용하며 GPU inbound port를 열지 않는다.

## 3. 배포와 rollback

~~~sh
~/.local/bin/liveclass-realtime-agent-deploy \
  "$PWD/ai/realtime-agent" "$(git rev-parse HEAD)"
~/.local/bin/liveclass-realtime-agent-supervisor status
curl --fail http://127.0.0.1:8081/health/ready
curl --fail http://127.0.0.1:8082/health/ready
~~~

배포 helper는 commit SHA별 release 생성, frozen Nemotron sync, CUDA smoke, current symlink 교체 후 기존
단일 agent session을 종료하고 prod/dev 두 session을 재시작한다. 두 readiness가 모두 성공해야 배포를
완료하며 하나라도 실패하면 두 신규 session을 정리하고 이전 release로 rollback한다. 시크릿, SSH key,
model checkpoint는 release에 복사하지 않는다.

GitLab `deploy-realtime-agent` job도 같은 helper를 현재 사용자로 호출한다. active 강의의 drain은
지원하지 않으므로 배포 시 두 worker job이 끊길 수 있다.

### 3.1 Qwen3-ASR 1.7B 기본 모델로 수동 전환

첫 vLLM 적용 대상은 이미 내려받은 `Qwen/Qwen3-ASR-1.7B` 기본 모델이다. merge와 일반 CD는
기존 Nemotron prod profile을 유지하므로 아래 명시적 절차에서만 바뀐다. 이 전환으로 serving wiring과
LiveKit canary를 검증할 수 있지만, fine-tuning 성능 승격 증거를 대신하지 않는다. GPU 1은 사용하지 않는다.

~~~sh
cd /home/liveclass/liveclass
ai/realtime-agent/deploy/install.sh /opt/tljh/user/bin/uv
~/.local/bin/liveclass-whisper-vllm-bootstrap

# `<user>`를 실제 사용자로 바꾸고 기본 모델 경로와 alias를 확인한다.
~/.local/bin/liveclass-realtime-agent-supervisor stop-agent-prod
~/.local/bin/liveclass-whisper-vllm-supervisor start
~/.local/bin/liveclass-whisper-vllm-supervisor status

cp -p ~/.config/liveclass/realtime-agent.env ~/.config/liveclass/realtime-agent-nemotron.env
cp ~/.config/liveclass/realtime-agent-vllm.env.example ~/.config/liveclass/realtime-agent.env
chmod 600 ~/.config/liveclass/realtime-agent.env
~/.local/bin/liveclass-realtime-agent-supervisor restart-agent-prod
curl --fail http://127.0.0.1:8081/health/ready
~~~

agent의 VLLM_WHISPER_MODEL과 runtime의 WHISPER_VLLM_SERVED_MODEL_NAME은 정확히 같아야 한다.
vLLM은 127.0.0.1:18083에만 bind하며 별도 GPU/EC2 inbound나 SSH tunnel을 추가하지 않는다.
첫 cap은 GPU memory utilization 0.10, max-num-batched-tokens 2048,
runtime max-num-seqs 1, agent active/idle 1/1이다.
학습 모델이 ADR-0040 gate를 통과하면 runtime의 model path만 merged checkpoint로 교체한다.

전환 실패 시 prod agent를 먼저 중지하고 vLLM을 중지한 뒤 저장한 Nemotron env를 복원한다.

~~~sh
~/.local/bin/liveclass-realtime-agent-supervisor stop-agent-prod
~/.local/bin/liveclass-whisper-vllm-supervisor stop
cp ~/.config/liveclass/realtime-agent-nemotron.env ~/.config/liveclass/realtime-agent.env
chmod 600 ~/.config/liveclass/realtime-agent.env
~/.local/bin/liveclass-realtime-agent-supervisor restart-agent-prod
~~~

실제 완료 조건은 GPU :8081과 EC2 :18081 readiness뿐 아니라 LiveKit canary의 caption final·sequence
회귀 0이다. 자세한 선택 근거와 rollback gate는
[ADR-0042](../../../docs/decisions/canola/0042-whisper-vllm-runtime-adapter.md)를 따른다.

## 4. 연결 구조와 상태 확인

```mermaid
flowchart LR
    subgraph GPU[GPU0]
        P[prod agent :8081]
        D[dev agent :8082]
        C[SSH control]
        T[SSH TURN]
    end
    subgraph EC2[EC2 loopback]
        L[LiveKit :7443]
        RD[dev Redis :4000]
        RP[prod Redis :6390]
        HP[prod health :18081]
        HD[dev health :18082]
        CT[TURN TCP :3478]
    end
    P --> C
    D --> C
    P --> T
    D --> T
    C -->|local 7443| L
    C -->|local 4000| RD
    C -->|local 6390| RP
    HP -->|reverse 18081 to 8081| P
    HD -->|reverse 18082 to 8082| D
    T -->|local 3478| CT
```

realtime control과 TURN은 서로 다른 SSH TCP connection이다. BGE도 전용 supervisor와 세 번째
connection에서 `EC2 18020 → GPU 8020`을 유지한다. 모두 GPU에서 EC2 22번으로 시작하므로 GPU inbound와
EC2 application 방화벽 포트를 추가하지 않는다.

`LIVEKIT_URL`은 TLS 인증서 hostname을 유지하되 배포 resolver가 그 hostname만 GPU loopback으로 해석한다.
prod는 `redis://127.0.0.1:6390/0`, dev는 password를 포함한 `redis://...@127.0.0.1:4000/0`을 사용하며
LiveKit 내부 Redis `6379`는 사용하지 않는다. OpenAI provider의 WSS는 tunnel과 별도인 outbound TLS 연결이고
`OPENAI_API_KEY`는 dev profile 파일로만 주입한다.

~~~sh
~/.local/bin/liveclass-realtime-agent-supervisor status
~/.local/bin/liveclass-realtime-agent-supervisor logs-agent-prod
~/.local/bin/liveclass-realtime-agent-supervisor logs-agent-dev
~/.local/bin/liveclass-realtime-agent-supervisor restart-agent-prod
~/.local/bin/liveclass-realtime-agent-supervisor restart-agent-dev
~/.local/bin/liveclass-realtime-agent-supervisor logs-tunnel
ss -ltn | grep -E ':(3478|4000|6390|7443|8081|8082)\b'
~~~

EC2 host에서는 prod `18081`, dev `18082`를 확인한다. host-network gpu-proxy를 수동 재배포하면 container
내부에서는 prod `/internal/realtime-agent/`, dev `/internal/realtime-agent-dev/` prefix를 사용할 수 있다.
두 reverse port는 계속 EC2 loopback에만 bind한다.

~~~sh
curl --fail http://127.0.0.1:18081/health/ready
curl --fail http://127.0.0.1:18082/health/ready
~~~

기존 SSH control master에 한 Redis forward만 있더라도 새 tunnel script가 누락된 `4000` 또는 `6390`
forward와 dev health reverse를 `ssh -O forward`로 추가한다. control 장애는 TURN을 종료하지 않고 TURN
장애도 LiveKit·Redis·health를 종료하지 않는다.

수동 tunnel helper의 입력과 검증은 [`../scripts/README.md`](../scripts/README.md), 전체 운영 절차는
[`../../../docs/ai/GPU-REALTIME-AGENT-RUNBOOK.md`](../../../docs/ai/GPU-REALTIME-AGENT-RUNBOOK.md)를 따른다.
