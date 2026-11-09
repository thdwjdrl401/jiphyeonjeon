# GPU realtime-agent 운영 RUNBOOK

> 현재 상태: 이 RUNBOOK이 쓰는 GPU 서버 배포 일습(`deploy/install.sh`, `deploy/bin/*` supervisor,
> `scripts/start_ec2_tunnels.sh`, `deploy/configure-gpu-ec2-tunnels.sh`, `livekit-tunnel-dns.c`,
> `realtime-agent.env.example`·`realtime-agent-dev.env.example`, `tests/test_operational_scripts.py`)는 삭제됐다
> (커밋 `c490634b`). 현재 실행 절차는 노트북 GPU에서 `deploy/run-laptop.sh`를 쓰는
> [`ai/realtime-agent/deploy/README.md`](../../ai/realtime-agent/deploy/README.md)다. 아래는 GPU 서버 시절 절차 기록이다.

GPU 서버에서 정식 clone의 realtime-agent를 CUDA/Nemotron으로 실행하고, SSH tunnel을 통해 외부
LiveKit·application Redis·coturn에 연결하는 절차다. 실제 secret, token, host, PEM 경로와 dispatch
ID는 문서나 Git에 기록하지 않는다.

## 네트워크 경계

표준 SSH local forwarding은 TCP만 전달한다. signaling/API와 application Redis는 control SSH
connection을 사용하고, WebRTC media는 별도 TURN SSH connection으로 EC2 loopback coturn의 TCP
listener를 전달한다. 두 connection 모두 EC2 22번으로 나가지만 ControlPath와 GPU source port가 달라
외부 TCP 혼잡과 재연결 장애 범위를 분리한다. 결정 근거는
[ADR-0033](../decisions/canola/0033-realtime-agent-ssh-channel-isolation.md)과
[ADR-0035](../decisions/canola/0035-realtime-agent-dual-environment-runtime.md)를 따른다.

| 서비스 | 기본 로컬 포트 | 원격 loopback 포트 |
|---|---:|---:|
| LiveKit signaling/API | `7443` | `7443` |
| dev application Redis | `4000` | `4000` |
| prod application Redis | `6390` | `6390` |
| TURN/TCP | `3478` | `3478` |
| prod realtime-agent health(reverse) | `8081` | `18081` |
| dev realtime-agent health(reverse) | `8082` | `18082` |
| BGE runtime(reverse) | `8020` | `18020` |

prod health `127.0.0.1:8081`은 EC2 `127.0.0.1:18081`, dev health `127.0.0.1:8082`는 EC2
`127.0.0.1:18082`로 reverse forward한다. GPU inbound port는 열지 않는다.

LiveKit 내부 Redis와 application Redis를 혼동하지 않는다. dev Redis `4000`은 `requirepass`라 URL에
password를 넣고, prod Redis `6390`은 EC2 loopback+SSH key로 제한되어 인증 없는 URL을 쓴다. SSH local
forward도 EC2 loopback에 붙으므로 외부 interface bind나 방화벽 개방을 추가하지 않는다. 인증을 바꾸면
credential은 문서가 아니라 각 secret 환경파일에 주입한다.

## 설치와 CUDA smoke

```sh
cd ai/realtime-agent
uv lock --check
uv sync --frozen --extra nemotron --group dev
uv run --frozen python -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"
```

모델은 Git 저장소 밖에 둔다. `ASR_MODEL_ID`에는 원격 model ID 또는 기존 로컬 모델의 절대경로를
주입하며 모델 파일을 clone 안으로 복사하지 않는다.

운영 host는 sudo 없는 rootless 배포를 사용한다. 사용자 Runner·tmux supervisor bootstrap과 장애
확인은 [GPU 배포 가이드](../../ai/realtime-agent/deploy/README.md)를 따른다.

## 운영 GPU SSH tunnel

이 절차는 개발자 PC가 아니라 realtime-agent와 BGE가 실행되는 운영 GPU 호스트에서 한 번 수행한다.
bootstrap은 전달받은 PEM을 Git 밖의 `~/.config/liveclass/ssh/gpu-to-ec2.pem`으로 복사하고 권한을
`0600`으로 고정한 뒤, 같은 EC2 target을 사용하는 두 서비스의 tunnel env를 함께 만든다. EC2 host key는
별도 채널로 확인해 `~/.ssh/known_hosts`에 먼저 등록한다.

```sh
cd /home/liveclass/liveclass
ai/realtime-agent/deploy/configure-gpu-ec2-tunnels.sh \
  /absolute/path/to/gpu-to-ec2.pem \
  <ec2-user>@<ec2-host> \
  --start
```

`--start`는 설치된 realtime-agent와 BGE의 사용자 tmux tunnel supervisor를 시작한다. realtime-agent
supervisor는 control과 TURN 두 connection을, BGE supervisor는 embedding reverse connection을 유지한다.
세 connection은 같은 PEM과 target을 사용하지만 서로 다른 SSH TCP connection이다. 따라서 BGE local
readiness나 TURN 연결 장애가 LiveKit·Redis 연결을 함께 끊지 않는다. 모두 GPU에서 EC2로 outbound
접속하므로 GPU security group에 inbound application port를 열지 않는다.

직접 helper를 실행하는 방식은 장애 분석용이다. 포트가 다르면 `LIVEKIT_LOCAL_PORT`,
`LIVEKIT_REMOTE_PORT`, `DEV_REDIS_*`, `PROD_REDIS_*`, `TURN_*`, `PROD_HEALTH_*`,
`DEV_HEALTH_*`를 명시한다.

```sh
set -a
. ~/.config/liveclass/realtime-agent-tunnels.env
set +a
ai/realtime-agent/scripts/start_ec2_tunnels.sh
ssh -F /dev/null -S "$SSH_CONTROL_PATH" -O check "$SSH_TARGET"
ssh -F /dev/null -S "$TURN_SSH_CONTROL_PATH" -O check "$SSH_TARGET"
```

GPU와 EC2 양쪽에서 listener와 HTTP 왕복을 확인한다.

```sh
# GPU
ss -ltn | grep -E ':(7443|4000|6390|3478|8020|8081|8082)\b'
~/.local/bin/liveclass-realtime-agent-supervisor status
~/.local/bin/liveclass-bge-runtime-supervisor status

# EC2
ss -ltn | grep -E ':(18020|18081|18082)\b'
curl --fail http://127.0.0.1:18020/readyz
curl --fail http://127.0.0.1:18081/health/ready
curl --fail http://127.0.0.1:18082/health/ready
```

## 기존 단일 worker에서 dev/prod로 전환

현재 `realtime-agent.env`를 prod 설정으로 유지하고, 기존 dev 설정의 안전한 백업에서
`realtime-agent-dev.env`를 만든다. dev 파일은 agent name `liveclass-realtime-stt-dev`, Redis credential,
health `8082`, active/idle `1/1`로 맞추고 prod 파일은 agent name `liveclass-realtime-stt-prod`와 운영 Redis
`6390`을 유지한다. secret을 명령행이나 로그로 출력하지 않는다.

새 tunnel script는 살아 있는 control master에 누락된 Redis `4000` 또는 `6390` forward와 dev health
`18082→8082` reverse를 동적으로 추가한다. 배포 helper의 `restart-agent`는 레거시
`liveclass-realtime-agent` tmux session을 종료하고 prod/dev session을 각각 시작한다. 병합 전 다음 파일이
모두 준비되어 있지 않으면 GPU 배포는 fail-closed한다.

```sh
test -r ~/.config/liveclass/realtime-agent.env
test -r ~/.config/liveclass/realtime-agent-dev.env
test -r ~/.config/liveclass/realtime-agent-tunnels.env
```

EC2 앱 배포가 prod `LIVEKIT_AGENT_NAME`을 먼저 바꾸므로 GPU 배포까지 잠깐 dispatch가 pending일 수 있다.
무중단 요구는 없지만 두 readiness와 각 이름의 worker 등록을 확인한 뒤 E2E를 시작한다. dev health proxy가
필요하면 `deploy-gpu-proxy` manual job도 실행한다.

## PEM 보유 로컬 개발자의 API provider 검증 — 운영 절차 아님

로컬 개발자는 EC2 security group에 LiveKit·Redis·TURN 포트를 새로 공개하지 않고 위 SSH local
forwarding만 사용한다. PEM은 `chmod 600`으로 제한하고, host key를 별도 채널로 확인해
`known_hosts`에 등록한다. PEM만으로는 LiveKit API·Redis·TURN 인증이 되지 않으므로 각 secret은
팀 secret manager에서 별도로 주입한다.

기본 포트가 로컬에서 사용 중이면 loopback 전용 대체 포트를 선택한다.

```sh
cd ai/realtime-agent
chmod 600 /path/to/developer.pem
SSH_KEY=/path/to/developer.pem \
SSH_TARGET=user@ec2-host \
LIVEKIT_LOCAL_PORT=17443 \
DEV_REDIS_LOCAL_PORT=14000 \
PROD_REDIS_LOCAL_PORT=16390 \
TURN_LOCAL_PORT=13478 \
./scripts/start_ec2_tunnels.sh
```

개발자별 gitignore된 env file도 `chmod 600`으로 제한한다. OpenAI key는 SSH나 EC2를 거치지 않고
로컬 agent process에서 OpenAI로 직접 나가며, `uv --env-file`로만 주입한다. 비용과 production
worker 간섭을 막기 위해 고유 agent name과 active/idle 1을 사용한다.

```dotenv
LIVEKIT_URL=wss://<certificate-host>:17443
LIVEKIT_API_KEY=<livekit-api-key>
LIVEKIT_API_SECRET=<livekit-api-secret>
LIVEKIT_TURN_URL=turn:127.0.0.1:13478?transport=tcp
LIVEKIT_TURN_SECRET=<coturn-rest-auth-secret>
REDIS_URL=redis://:<password>@127.0.0.1:14000/0
STT_AGENT_NAME=liveclass-realtime-stt-<developer>
STT_ENGINE_PROVIDER=openai-realtime
STT_MAX_ACTIVE_JOBS=1
STT_NUM_IDLE_PROCESSES=1
OPENAI_API_KEY=<secret>
OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-realtime-whisper
OPENAI_REALTIME_TRANSCRIPTION_DELAY=low
```

```sh
chmod 600 /path/to/realtime-agent.local.env
uv run --env-file /path/to/realtime-agent.local.env --frozen python -m app.main dev
```

`LIVEKIT_URL`의 인증서 hostname은 loopback으로 resolve하되 URL을 `localhost`로 바꾸지 않는다.
고유 `session-{UUID}` room과 해당 개발자 agent name으로만 manual dispatch하고 production Spring
dispatch와 섞지 않는다. 검증이 끝나면 agent를 종료한 뒤 두 control path의 tunnel을 각각 닫는다.

```sh
SSH_CONTROL_PATH="${TMPDIR:-/tmp}/liveclass-realtime-agent-%C.sock"
TURN_SSH_CONTROL_PATH="${TMPDIR:-/tmp}/liveclass-realtime-agent-turn-%C.sock"
ssh -S "$SSH_CONTROL_PATH" -O exit user@ec2-host
ssh -S "$TURN_SSH_CONTROL_PATH" -O exit user@ec2-host
```

## 환경 주입과 실행

supervisor는 prod `~/.config/liveclass/realtime-agent.env`와 dev
`~/.config/liveclass/realtime-agent-dev.env`를 각각 로드한다. 두 파일은 LiveKit/TURN credential과 model
경로를 공유하지만 다음 값은 반드시 다르게 둔다.

```dotenv
# prod realtime-agent.env
REDIS_URL=redis://127.0.0.1:6390/0
STT_AGENT_NAME=liveclass-realtime-stt-prod
STT_HEALTH_PORT=8081
CUDA_VISIBLE_DEVICES=0
STT_ENGINE_PROVIDER=nemotron
STT_MAX_ACTIVE_JOBS=12
STT_NUM_IDLE_PROCESSES=12
```

```dotenv
# dev realtime-agent-dev.env
REDIS_URL=redis://:<dev-password>@127.0.0.1:4000/0
STT_AGENT_NAME=liveclass-realtime-stt-dev
STT_HEALTH_PORT=8082
CUDA_VISIBLE_DEVICES=0
STT_ENGINE_PROVIDER=nemotron
STT_MAX_ACTIVE_JOBS=1
STT_NUM_IDLE_PROCESSES=1
```

prod Spring Compose는 `LIVEKIT_AGENT_NAME=liveclass-realtime-stt-prod`, `remote` 프로필의 dev Spring은
`LIVEKIT_AGENT_NAME` 미지정 시 `liveclass-realtime-stt-dev`를 사용한다. 값이 뒤바뀌면 dispatch가 다른 Redis
환경에 배정되므로 배포를 중단한다.

`LIVEKIT_URL`은 인증서 hostname을 유지해야 한다. sudo 없는 운영 host는 배포에 포함된 C source를
`~/.local/lib/liveclass/livekit-tunnel-dns.so`로 빌드하고, `LIVEKIT_TUNNEL_HOST`와
`LD_PRELOAD`로 해당 hostname만 loopback tunnel에 연결한다. `/tmp`의 사전 빌드 바이너리는
사용하지 않는다.
`CUDA_VISIBLE_DEVICES=0`은 두 worker와 모든 child에 같은 물리 GPU 한 장만 노출한다. 검증된 prod
12-request burst는 active/idle `12/12`와 peak 81,468 MiB를 유지한다. dev를 같은 `12/12`로 복제하면 두
환경 full load에서 기존 단일-worker 실측 상한을 합산하게 되므로 기본 `1/1`만 허용한다. dev 용량을
늘리려면 prod와 동시에 부하를 건 GPU memory·latency 검증과 ADR 갱신이 먼저다.

```sh
~/.local/bin/liveclass-realtime-agent-supervisor restart-agent
~/.local/bin/liveclass-realtime-agent-supervisor status-agent
```

## read-only probe와 수동 E2E

probe는 participant token으로 room에 join하지 않고 LiveKit RoomService로 기존 상태만 조회한다. API
credential은 process environment로 주입하고 command line에 직접 쓰지 않는다.

```sh
uv run --frozen python scripts/probe_livekit_room.py --room session-<session-uuid>
```

probe는 기존 room과 microphone publication만 읽고 room을 만들거나 media를 subscribe하지 않는다.
수동 dispatch는 strict UUID metadata, `session-{sessionId}` room, 강사 participant와 unmuted microphone을
모두 확인하고 동일 metadata dispatch가 있으면 재사용한다.

```sh
uv run --frozen python scripts/dispatch_existing_room.py \
  --room session-<session-uuid> \
  --instructor <participant-identity> \
  --session-id <session-uuid> \
  --lesson-id <lesson-uuid> \
  --correlation-id <safe-id>
```

자막은 한 session만 필터링해 확인한다. invalid UTF-8은 명시적인 오류로 종료한다.

```sh
uv run --frozen python scripts/monitor_caption_stream.py \
  --session-id <session-uuid> --from-id 0-0
```

## 완료 gate

```sh
uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check app tests scripts
uv run --frozen ruff format --check app tests scripts
```

운영 완료에는 단위 테스트 외에 기존 room probe, Redis PING, TURN/TCP microphone 수신, 해당 session의
`caption.delta`와 `caption.stream.completed`, lease release, terminal first-wins, Spring dispatch/consumer,
30분 연속 실행 검증이 필요하다. 과거 실험의 약 157초 성공은 migration 근거지만 장시간 안정성 증거는
아니다.

## 장애 분류

- CUDA unavailable: driver를 먼저 바꾸지 말고 frozen PyTorch/CUDA 버전과 `torch.version.cuda`를 확인한다.
- signaling 성공·audio timeout: SSH `-L`이 UDP를 전달하지 않는 점과 TURN/TCP listener·credential을 확인한다.
- TLS hostname 오류: `LIVEKIT_URL`을 localhost로 바꾸지 말고 인증서 hostname의 routing을 수정한다.
- Redis auth 오류: LiveKit Redis가 아닌 application Redis인지, `default` 사용자 URL 형식인지 확인한다.
- 약 157초 후 disconnect: LiveKit disconnect reason, ICE/TURN 연결, tunnel keepalive와 queue backlog를 함께
  기록하고 30분 gate를 재실행한다.

## 2026-07-30 production Redis 전환 기록

- EC2 loopback `127.0.0.1:6390`에 publish된 production application Redis를 GPU
  `127.0.0.1:6390`으로 local forward했다. EC2 방화벽과 외부 bind는 추가하지 않았다.
- control SSH master를 `-L 6390:localhost:6390`으로 재생성했고 TURN·BGE connection은 유지했다.
- production Redis PING, GPU agent live/ready, EC2 reverse ready, Nemotron 12/12 warm process와 LiveKit
  worker 등록을 확인했다.

## 2026-07-28 migration 검증 기록

- H200 NVL 2장 환경에서 `torch 2.11.0+cu128`, CUDA runtime 12.8, CUDA available을 확인했다.
- 저장소 밖 로컬 Nemotron 모델을 offline으로 `cuda:0`에 로드했다.
- frozen 환경의 realtime-agent 테스트 296개와 Ruff check/format이 통과했다.
- 당시 개발 검증 경로에서 LiveKit 7443, application Redis 4000, TURN/TCP 3478 listener를 확인했다.
- application Redis의 내장 `default` 사용자 password 인증 PING이 성공했다.
- RoomService read-only probe로 기존 room과 unmuted microphone publication을 확인했다.
- relay-only custom ICE로 기존 room에 연결해 TURN/TCP peer connection을 확인했다.
- worker가 named agent로 등록되고 정상 drain/shutdown됐다.
- `CUDA_VISIBLE_DEVICES=0`, `STT_MAX_ACTIVE_JOBS` 미지정, idle 12의 capacity startup에서 provider
  기본 active 12가 선택되고 Nemotron child 12개가 모두 초기화된 뒤 worker가 등록됐다. GPU 0은
  process당 2952 MiB, 합계 35,503 MiB를 사용했고 GPU 1은 0 MiB였다.
- strict `session-{UUID}` room과 explicit dispatch를 각각 12개 동시에 생성해 agent participant 12/12
  입장과 worker load 1.0 FULL을 확인했다. 언어가 일치하는 8초 `en-US` speech를 동시에 전송했을 때
  모든 session이 caption delta 17–23개와 completion 1개를 발행했다.
- 12개 동시 추론 중 GPU 0은 SM 99–100%, peak 81,468 MiB였고 GPU 1은 사용하지 않았다. room과
  worker를 정리한 뒤 두 GPU 모두 0 MiB로 복귀했다. 운영 기본 `ko-KR`의 자연스러운 한국어 발화
  CER/지연과 30분 연속 실행은 별도 gate다.
- 기존 비민감 microphone을 임시 strict `session-{UUID}` room으로 relay해 Gate D를 수행했다. manual
  dispatch의 room·participant·microphone 검증 후 Nemotron이 `caption.delta` 54개를 sequence 1–54로
  발행했고 UTF-8 decode 오류가 없었다.
- room 삭제 후 `caption.stream.completed`가 정확히 1개 발행됐고 `reason=ROOM_DELETED`,
  `lastSequence=54`였으며 session lease key가 제거됐다. 임시 room·bridge·worker도 종료했다.
- Spring named dispatch/consumer Gate E와 30분 안정성 Gate F도 미완료다.
