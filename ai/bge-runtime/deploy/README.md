# GPU bge-runtime rootless 배포

GPU 호스트에는 sudo 권한과 boot-time user service가 없다. 따라서 bge-runtime과 EC2 reverse SSH
tunnel을 현재 사용자 소유 release와 tmux supervisor로 운영한다. terminal을 닫아도 process는
유지되고, runtime 또는 tunnel이 종료되면 supervisor가 다시 실행한다.

GPU/Jupyter 호스트가 재시작되면 tmux와 사용자 Runner도 종료된다. 현재 권한에서는 boot-time 자동
시작을 설치할 수 없으므로 재시작 후 GitLab Runner를 한 번 시작해야 한다. 이후 master 배포는
pipeline이 처리한다.

## 1. 사용자 영역 bootstrap

~~~sh
cd /home/liveclass/liveclass
ai/bge-runtime/deploy/install.sh /home/liveclass/.local/bin/uv
chmod 600 ~/.config/liveclass/bge-runtime.env ~/.config/liveclass/bge-tunnel.env
~~~

설치 위치는 다음과 같다.

- helper: `~/.local/bin/liveclass-bge-runtime-*`
- release/cache: `~/.local/share/liveclass/bge-runtime`
- secret 설정: `~/.config/liveclass/bge-runtime.env`, `~/.config/liveclass/bge-tunnel.env`

installer는 기존 환경파일을 덮어쓰지 않는다. BGE token은 EC2 ai-worker의
`AI_WORKER_BGE_INTERNAL_TOKEN`과 같아야 하고, SSH host key는 `~/.ssh/known_hosts`에 미리 등록한다.
모델은 pinned revision이 Hugging Face cache에 있어야 하며 운영 환경은 offline mode로 실행한다.

supervisor와 deploy helper는 inherited 환경과 무관하게 `CUDA_VISIBLE_DEVICES=0`과
`BGE_RUNTIME_DEVICE=cuda`를 강제한다. 이 호스트에서는 GPU 1을 사용하지 않는다.

## 2. Runner와 pipeline

realtime-agent와 같은 `gpu-realtime` project Runner를 공유한다. Runner 설치·등록은
[realtime-agent rootless 배포 가이드](../../realtime-agent/deploy/README.md#2-gpu-project-runner-등록)를
따른다. 등록 token은 저장소나 로그에 남기지 않는다.

~~~sh
~/.local/bin/liveclass-gitlab-runner-user start
~/.local/bin/liveclass-gitlab-runner-user status
~~~

Runner 등록과 수동 최초 배포가 성공하면 protected CI 변수 `GPU_DEPLOY_ENABLED=1`을 설정한다.
`deploy-bge-runtime` job은 EC2 application 배포 성공 뒤 현재 사용자로 helper를 실행한다. realtime-agent
job과 `gpu0-production` resource group을 공유하므로 한 물리 GPU에서 두 배포가 동시에 실행되지 않는다.

## 3. 최초 배포와 상태 확인

~~~sh
~/.local/bin/liveclass-bge-runtime-deploy \
  "$PWD/ai/bge-runtime" "$(git rev-parse HEAD)"
~/.local/bin/liveclass-bge-runtime-supervisor status
~/.local/bin/liveclass-bge-runtime-supervisor health
curl --fail http://127.0.0.1:8020/readyz
~~~

helper는 commit SHA별 staging 복사, frozen CUDA dependency 설치, GPU0 smoke, `current` symlink 교체,
runtime warmup, tunnel 재시작 순서로 실행한다. local readiness가 실패하면 이전 release로 rollback한다.
시크릿, SSH key와 model checkpoint는 release에 복사하지 않는다.

EC2에서는 loopback reverse tunnel과 실제 embedding 왕복을 확인한다.

~~~sh
curl --fail http://127.0.0.1:18020/readyz
cd ai/ai-worker
AI_WORKER_BGE_RUNTIME_URL=http://127.0.0.1:18020 \
AI_WORKER_BGE_INTERNAL_TOKEN='<same-token>' \
uv run --frozen python scripts/smoke_remote_bge.py
~~~

로그와 제어 명령은 다음과 같다.

~~~sh
~/.local/bin/liveclass-bge-runtime-supervisor logs-runtime
~/.local/bin/liveclass-bge-runtime-supervisor logs-tunnel
~/.local/bin/liveclass-bge-runtime-supervisor restart
~~~
