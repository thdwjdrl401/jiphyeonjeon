# realtime-agent 배포

실시간 자막 에이전트를 **작업용 노트북의 GPU**에서 돌린다.

전용 GPU 서버가 있던 시절에는 rootless tmux supervisor, EC2로의 SSH 터널, LiveKit TLS 호스트네임을
속이는 `LD_PRELOAD` DNS shim, UDP가 안 넘어가서 쓰던 TURN relay-only 우회가 필요했다. 그 서버가
회수되면서 그 장치들은 전부 제거했다 — 지금은 LiveKit이 공개 도메인으로 열려 있어 에이전트가
바로 붙는다.

## 왜 노트북인가

임베딩(BGE)과 달리 실시간 STT는 **강의 중에만** 필요하다. 서버는 항상 켜져 있어야 하지만
에이전트는 그렇지 않다. 그래서 임베딩은 상시 가동 호스트의 CPU로 내리고(ADR-0125), STT는
GPU가 있는 노트북에 둔다.

노트북이 꺼져 있으면 자막만 멈춘다. 강의·녹화·RAG는 서버에서 그대로 돈다.

## 연결 구조

에이전트는 **밖으로 나가는 연결만** 만든다. 노트북으로 들어오는 인바운드가 없어서 포트를 열
필요도, 고정 IP도 필요 없다. 카페에서 켜도 똑같이 동작한다.

```
① backend ──dispatch(agent name)──► LiveKit
② LiveKit ──job──► 에이전트          (에이전트가 걸어 둔 WebSocket으로 밀어 준다)
③ 에이전트 ──wss 7443──► LiveKit     (공개 시그널링, 터널 없음)
④ 에이전트 ──ssh -L──► 서버 Redis    (자막 스트림이 서버 루프백에만 열려 있다)
⑤ backend가 그 스트림을 읽어 학생에게 WebSocket으로 민다
```

`STT_AGENT_NAME`은 backend의 `LIVEKIT_AGENT_NAME`과 **같아야** 한다. 다르면 dispatch가 아무에게도
가지 않고, 라이브는 시작되지만 자막만 조용히 없다.

## 실행

```bash
cd ai/realtime-agent
cp deploy/env/realtime-agent-laptop.env.example deploy/env/laptop.env
# LIVEKIT_API_KEY / LIVEKIT_API_SECRET 채우기 (서버의 livekit/CREDENTIALS.txt)
bash deploy/run-laptop.sh
```

스크립트가 Redis 터널을 열고(이미 열려 있으면 건너뛴다) 의존성을 맞춘 뒤 에이전트를 띄운다.
노트북이 서버와 같은 LAN에 있으면 터널 대신 `REDIS_URL`을 서버의 LAN 주소로 직접 적어도 된다.

기동 확인은 로그의 `registered worker`와 `agent_name`이다. GPU에 모델이 올라가는 데 시간이
걸리므로(가중치를 처음 받으면 더 길다) 그 줄이 나올 때까지 기다린다.

## 모델

`ASR_MODEL_ID`는 HuggingFace 모델 ID를 그대로 쓴다. 기본값은 베이스
`nvidia/nemotron-3.5-asr-streaming-0.6b`다.

**파인튜닝 체크포인트(`.nemo`)는 GPU 서버와 함께 사라졌다.** 그 파일을 다시 확보하면
`STT_ENGINE_PROVIDER=nemotron-nemo`와 `NEMO_RUNTIME_MODEL_PATH`로 바꿔 한국어 정확도를 되돌릴 수
있다(`nemotron-nemo.env.example` 참고). vLLM 경로(`realtime-agent-vllm.env.example`)도 같은
사정이라 체크포인트가 있어야 쓴다.

GPU 없이 돌려야 하면 `STT_ENGINE_PROVIDER=openai-realtime`으로 바꾸고 `OPENAI_API_KEY`를 넣는다.
종량 과금이고 한국어 정확도는 검증하지 않았다.

## VRAM

`STT_MAX_ACTIVE_JOBS`와 `STT_NUM_IDLE_PROCESSES`가 동시 처리량을 정한다. 프로세스당 약 3GB를
쓰므로 8GB 노트북 GPU에서는 **1로 둔다** — 동시 강의 하나만 자막이 붙는다. 늘리면 VRAM이 먼저
바닥난다.
