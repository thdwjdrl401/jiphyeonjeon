# GPU realtime-agent 운영 RUNBOOK

GPU 서버에서 정식 clone의 realtime-agent를 CUDA/Nemotron으로 실행하고, SSH tunnel을 통해 외부
LiveKit·application Redis·coturn에 연결하는 절차다. 실제 secret, token, host, PEM 경로와 dispatch
ID는 문서나 Git에 기록하지 않는다.

## 네트워크 경계

표준 SSH local forwarding은 TCP만 전달한다. signaling/API와 application Redis는 각각 TCP tunnel을
사용하고, WebRTC media는 EC2 loopback coturn의 TCP listener를 별도 tunnel로 전달한다.

| 서비스 | 기본 로컬 포트 | 원격 loopback 포트 |
|---|---:|---:|
| LiveKit signaling/API | `7443` | `7443` |
| application Redis | `4000` | `4000` |
| TURN/TCP | `3478` | `3478` |

LiveKit 내부 Redis와 application Redis를 혼동하지 않는다. application Redis가 내장 `default` 사용자를
쓰면 URL의 username은 비우고 password만 주입한다.

## 설치와 CUDA smoke

```sh
cd ai/realtime-agent
uv lock --check
uv sync --frozen --extra nemotron --group dev
uv run --frozen python -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"
```

모델은 Git 저장소 밖에 둔다. `ASR_MODEL_ID`에는 원격 model ID 또는 기존 로컬 모델의 절대경로를
주입하며 모델 파일을 clone 안으로 복사하지 않는다.

## SSH tunnel

```sh
SSH_KEY=/path/to/key.pem \
SSH_TARGET=user@host \
./scripts/start_ec2_tunnels.sh
```

스크립트는 host와 key 경로를 기본값으로 갖지 않는다. 포트가 다르면 `LIVEKIT_LOCAL_PORT`,
`LIVEKIT_REMOTE_PORT`, `REDIS_LOCAL_PORT`, `REDIS_REMOTE_PORT`, `TURN_LOCAL_PORT`,
`TURN_REMOTE_PORT`를 명시한다. listener는 `nc` 또는 `ss`로 확인한다.

## 환경 주입과 실행

production은 process environment나 secret manager로 값을 주입한다. `.env`를 자동 로드하지 않는다.
로컬 개발에서만 `uv --env-file`에 파일 경로를 명시한다.

```dotenv
LIVEKIT_URL=wss://livekit.example:7443
LIVEKIT_TURN_URL=turn:127.0.0.1:3478?transport=tcp
LIVEKIT_TURN_SECRET=<coturn-rest-auth-secret>
REDIS_URL=redis://:<password>@127.0.0.1:4000/0
STT_ENGINE_PROVIDER=nemotron
STT_MAX_ACTIVE_JOBS=1
ASR_MODEL_ID=/path/outside/git/nemotron-3.5-asr-streaming-0.6b
```

`LIVEKIT_URL`은 인증서 hostname을 유지해야 한다. hostname을 loopback tunnel로 연결하는 방법은 배포
환경의 DNS/hosts/proxy 정책으로 제공하며 `/tmp`의 사전 빌드 바이너리를 영구 전제로 삼지 않는다.

```sh
uv run --env-file /path/to/realtime-agent.env --frozen python -m app.main start
```

## read-only probe와 수동 E2E

participant token은 shell history에 남지 않도록 환경으로 주입한다.

```sh
LIVEKIT_TOKEN='<short-lived-token>' uv run --frozen python scripts/probe_livekit_room.py
```

probe는 auto-subscribe를 끄고 기존 room과 microphone publication만 읽는다. room을 만들지 않는다.
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
