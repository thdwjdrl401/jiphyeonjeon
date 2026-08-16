# realtime-agent 진단 스크립트

에이전트를 띄우는 것은 [`deploy/run-laptop.sh`](../deploy/README.md)가 한다. 여기 있는 것은
문제가 생겼을 때 상태를 들여다보는 도구다.

전용 GPU 서버 시절에는 EC2로 여러 포트를 잇는 터널 스크립트가 있었다 — LiveKit 시그널링, dev/prod
Redis, TURN relay, 그리고 health 확인을 위한 리버스 터널까지. 그 서버가 회수되고 LiveKit이 공개
도메인으로 열리면서 그 대부분이 필요 없어졌다. 지금 남은 터널은 **자막용 Redis 하나**뿐이고
`run-laptop.sh`가 연다.

## 도구

| 스크립트 | 쓰임 |
|---|---|
| `probe_livekit_room.py` | 방에 누가 들어와 있는지, 어떤 트랙을 내고 있는지 본다. "강사 연결이 확인된 뒤…"로 라이브가 안 시작될 때 |
| `dispatch_existing_room.py` | 이미 떠 있는 방에 에이전트 job을 수동으로 던진다. dispatch 경로만 따로 확인할 때 |
| `monitor_caption_stream.py` | Redis 자막 스트림을 실시간으로 따라간다. 에이전트는 도는데 자막이 안 보일 때 |

셋 다 `deploy/env/laptop.env`와 같은 값(LiveKit 자격·Redis URL)을 환경에서 읽는다.

## 자막이 안 나올 때 보는 순서

1. 에이전트 로그에 `registered worker`가 있는가 — 없으면 LiveKit에 붙지 못한 것이다.
2. `STT_AGENT_NAME`이 backend의 `LIVEKIT_AGENT_NAME`과 같은가 — 다르면 dispatch가 아무에게도 가지 않는다.
3. `probe_livekit_room.py`로 강사가 실제로 오디오를 내고 있는가.
4. `monitor_caption_stream.py`로 스트림에 쓰이고 있는가 — 쓰이는데 화면에 없으면 backend 소비자 쪽 문제다.
