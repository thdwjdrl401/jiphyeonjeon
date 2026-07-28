# GPU realtime-agent 배포

GitLab의 한 pipeline이 EC2 배포 뒤 별도 GPU 서버의 realtime-agent를 갱신한다. LiveKit Worker 등록은
배포 데이터가 아니라 agent process의 authenticated WebSocket 연결 상태다. GPU service가 시작되면
같은 `STT_AGENT_NAME`으로 자동 등록하고, `http://127.0.0.1:8081/`이 `200`을 반환해야 배포가 성공한다.

## 1. GPU project runner 등록

GitLab 프로젝트에서 runner를 만들고 GPU 서버에 shell executor로 등록한다.

- tag: `gpu-realtime`
- project에 lock
- protected branch만 허용
- untagged job 실행 금지
- 동시 실행 수 1

Runner 인증 token은 GitLab 화면에서 한 번만 사용하며 파일, CI 변수 출력, 문서에 기록하지 않는다.
Runner와 host bootstrap 검증이 모두 끝난 뒤 protected CI 변수 `GPU_DEPLOY_ENABLED=1`을 설정한다.
GPU runner는 GitLab로 outbound 연결만 하면 되고 외부 inbound 포트를 열지 않는다.

## 2. host bootstrap

GPU 서버에 `gitlab-runner`, `rsync`, `curl`, `openssh-client`, NVIDIA driver가 준비돼 있어야 한다.
저장소의 install script는 `liveclass-ai` service user, 배포 helper, systemd unit과 예제 환경 파일을
설치한다. 현재 서버처럼 uv가 일반 경로 밖에 있으면 절대경로를 넘긴다.

```sh
sudo ai/realtime-agent/deploy/install.sh /opt/tljh/user/bin/uv
```

다음 파일을 실제 값으로 수정한다.

- `/etc/liveclass/realtime-agent.env`
- `/etc/liveclass/realtime-agent-tunnels.env`

한 GPU만 쓰는 현재 profile은 agent env에 `CUDA_VISIBLE_DEVICES=0`,
`STT_MAX_ACTIVE_JOBS=12`, `STT_NUM_IDLE_PROCESSES=12`를 둔다. LiveKit Agents 1.6.6의 동시
availability reservation은 idle 수를 초기 burst admission slot으로 사용하므로 두 값을 같게 둬야
12개 동시 dispatch를 모두 받는다. `CUDA_VISIBLE_DEVICES`는 service와
LiveKit job child에 상속되므로 모든 Nemotron model이 같은 물리 GPU 안에 올라간다.

SSH private key는 Git 저장소 밖에 두고 `liveclass-ai`만 읽을 수 있게 한다. EC2 host key fingerprint를
별도 채널로 확인한 뒤 `/srv/liveclass/realtime-agent/.ssh/known_hosts`에 등록한다. `StrictHostKeyChecking`
을 끄지 않는다.

Runner 설치보다 bootstrap을 먼저 했다면 sudoers 파일을 별도로 설치하고 검사한다.

```sh
sudo install -m 0440 ai/realtime-agent/deploy/sudoers/liveclass-realtime-agent \
  /etc/sudoers.d/liveclass-realtime-agent
sudo visudo -cf /etc/sudoers.d/liveclass-realtime-agent
```

최초 설정 검증 후 tunnel을 시작하고 첫 release를 배포한 다음 service를 활성화한다.

```sh
sudo systemctl enable --now liveclass-realtime-agent-tunnels.service
sudo /usr/local/sbin/liveclass-realtime-agent-deploy \
  "$PWD/ai/realtime-agent" "$(git rev-parse HEAD)"
sudo systemctl enable liveclass-realtime-agent.service
curl --fail http://127.0.0.1:8081/
```

## 3. pipeline 동작

MR의 `test-realtime-agent` job은 GPU 없이 다음을 검증한다.

1. frozen dependency sync
2. pytest
3. Ruff
4. wheel build

`GPU_DEPLOY_ENABLED=1`인 master에서 `ai/realtime-agent/**` 또는 CI 설정이 바뀌면
`deploy-realtime-agent`가 실행된다. 이 job은
EC2 `deploy`를 기다린 뒤 GPU runner에서 root-owned helper만 호출한다. `DEPLOY_ALL=1`로 pipeline을
실행하면 LiveKit 배포도 자동 실행되고, GPU 배포는 EC2 앱과 LiveKit job 둘 다 성공할 때까지 기다린다.

배포 helper는 다음 순서로 실행한다.

1. commit SHA별 staging release 복사
2. `uv sync --frozen --no-dev --extra nemotron`
3. CUDA import와 availability smoke
4. 검증된 release를 root 소유 read-only 경계로 전환
5. `current` symlink 원자적 교체
6. tunnel service 시작과 agent restart
7. LiveKit 연결을 포함한 agent health 확인
8. health 실패 시 이전 release로 rollback

시크릿과 모델은 release에 복사하지 않는다. 모델은 `ASR_MODEL_ID`가 가리키는 Git 외부 절대경로에
유지한다. release 자동 삭제는 하지 않으므로 운영자가 사용 중 release를 피해서 별도 보존 정책으로
정리한다.

## 4. 장애 확인

```sh
systemctl status liveclass-realtime-agent-tunnels.service
systemctl status liveclass-realtime-agent.service
journalctl -u liveclass-realtime-agent.service -n 100 --no-pager
curl --fail http://127.0.0.1:8081/
```

- GPU runner가 offline이면 job은 pending 상태다. EC2 runner가 대신 실행하지 않는다.
- tunnel이 죽으면 foreground ssh process가 종료되고 systemd가 재시작한다.
- agent가 LiveKit 연결 재시도 한도를 소진해 종료하면 systemd가 다시 시작한다.
- active 강의 중 배포는 최대 300초 drain 후 종료될 수 있다. 무중단 rollout은 이 구성의 목표가 아니다.
