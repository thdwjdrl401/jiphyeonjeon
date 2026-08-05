# realtime-agent

## 1. 이 서비스가 하는 일

`realtime-agent`는 GPU에서 실행되는 LiveKit Agents worker다. 강사 microphone을 받아 streaming STT로
변환하고 application Redis에 실시간 자막을 발행한다. STT provider는 로컬 Nemotron,
GPU0 loopback vLLM Whisper 또는 OpenAI Realtime을 선택할 수 있다.

FastAPI 서비스가 아니며 작업을 받는 POST endpoint도 없다. LiveKit `AgentServer`가 outbound WebSocket으로
등록한 뒤 named dispatch를 통해 room job을 받는다.

> `caption.stream.started`·`caption.segment.final`은 루트 계약 §3-4에 채택됐고 AI producer와
> Spring consumer가 구현됐다. `segment.final`은 권위 자막으로 WS·REST에도 전달한다.

## 2. 누가 어떻게 호출하는가

| 호출자 | 대상 | 통신 | 용도 | 상태 |
|---|---|---|---|---|
| Spring | LiveKit AgentDispatch | Server API | agent name과 session metadata 전달 | 양쪽 구현, readiness 우회 |
| LiveKit | realtime-agent | persistent Worker WebSocket | 등록·load·job 배정 | 구현됨 |
| 강사 브라우저 → LiveKit → job | instructor microphone | WebRTC | STT audio 입력 | 구현됨 |
| job | Nemotron, vLLM Whisper 또는 OpenAI Realtime | local CUDA, loopback HTTP 또는 WSS | transcript 생성 | 구현됨 |
| realtime-agent | Redis `ai:captions:live` | Redis Stream `XADD` | 자막 started·delta·segment.final·완료 event | producer·consumer 구현 |
| realtime-agent | Redis `agent:session:{sessionId}` | Redis lease | 중복 job 방지 | 구현됨 |
| realtime-agent | Spring callback URL | HTTP, HMAC | job lifecycle 상태 전달 | 기본 비활성, Java 미구현 |
| 운영 환경 | `GET /health/live`, `GET /health/ready` | HTTP | process 생존·warm pool/LiveKit 준비 확인 | 구현됨 |

Spring은 agent를 직접 HTTP 호출하지 않는다. named dispatch 생성·재사용·삭제와 caption consumer는 구현됐지만
job별 readiness는 `live.stt.assume-ready=true`로 우회 중이다. lifecycle callback receiver와 realtime-agent
health client는 아직 없다. Python stop API나 Redis stop command도 없으며
Spring의 LiveKit room 삭제로 발생한 `ROOM_DELETED`만 정상 종료 신호로 사용한다.

채택된 서비스 간 계약과 구현 상태는 [`docs/ai/CONTRACT.md`](../../docs/ai/CONTRACT.md)를 따르고,
producer 내부 구현 상세는 이 폴더의 [`CONTRACT.md`](CONTRACT.md)가 기록한다.

## 3. 통신 예시

Spring이 LiveKit explicit dispatch에 넣어야 하는 metadata다. 대상 room 이름은
`session-{sessionId}`다. dev는 `liveclass-realtime-stt-dev`, prod는
`liveclass-realtime-stt-prod`를 사용하며 Spring의 `LIVEKIT_AGENT_NAME`도 대상 환경과 같아야 한다.

```json
{
  "contractVersion": "1",
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "lessonId": "22222222-2222-4222-8222-222222222222",
  "correlationId": "live-session-1"
}
```

AI producer의 자막 계약은 application Redis `ai:captions:live`에
`stream.started → delta/segment.final 반복 → stream.completed` 순서로 기록된다. delta 예시는 다음과 같다.

```text
contractVersion=1
eventId=33333333-3333-4333-8333-333333333333
type=caption.delta
sessionId=11111111-1111-4111-8111-111111111111
lessonId=22222222-2222-4222-8222-222222222222
sttSessionId=nemotron:0123456789abcdef0123456789abcdef
sequence=1
streamElapsedMs=1250
text=오늘은 벡터 검색을 설명하겠습니다.
occurredAt=2026-07-29T04:00:01.250Z
```

첫 frame 전에 `caption.stream.started.audioStartedAt`으로 stream 0의 UTC를 고정하고, VAD가 발화를
확정할 때 `caption.segment.final`에 실제 speech start/end와 권위 text를 기록한다. 정상 종료는 같은 stream의
`caption.stream.completed`다. Redis 직전에는 provider 공통 표시 정규화를 적용해 모든 dash와 반복
`ㅋ`·`ㅎ`, 괄호형 웃음 marker를 제거한다. 정규화 후 빈 발화는 delta·final과 sequence를 만들지 않는다.
전체 필드와 정책은 [`CONTRACT.md`](CONTRACT.md)에서 확인한다.

## 4. 처리 흐름

```text
Spring → LiveKit named dispatch
             ↓
Frontend microphone → LiveKit Room → realtime-agent job
                                      → Nemotron CUDA / vLLM loopback HTTP / OpenAI WSS
                                      → Redis caption.stream.started
                                      → Redis caption.delta
                                      → Redis caption.segment.final
Spring room delete → ROOM_DELETED     → Redis caption.stream.completed
                                      → Spring lifecycle callback (선택)
```

job은 metadata와 room 이름을 검증한 뒤 Redis lease를 얻고 microphone 하나만 구독한다. `sequence`와
`streamElapsedMs`는 `(sessionId, sttSessionId)` attempt 기준이며 Spring session clock과 동일하지 않다.
컴포넌트별 상세 흐름은 [STT→Redis 구조도](ARCHITECTURE.md)에 있다.

## 5. 실행과 설정

```bash
cd ai/realtime-agent
uv sync --frozen --extra nemotron
uv run --frozen --env-file ../.env python -m app.main start
```

기본 설정은 [`ai/.env.example`](../.env.example)을 `ai/.env`로 복사해 사용한다.
GPU 배포에서는 `deploy/env/realtime-agent-common.env.example`의 공통 LiveKit/TURN·운영 정책을 먼저 로드하고, prod/dev provider profile을 나중에 덮어쓴다. 같은 provider에 필요하지 않은 model key나 CUDA 변수는 profile에 넣지 않는다.

| 환경변수 | 필요 조건 | 용도 |
|---|---|---|
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | 실행 필수 | LiveKit Worker 등록 |
| `STT_ENGINE_PROVIDER` | 실행 필수 | `nemotron`, `vllm-whisper`, `openai-realtime`, `stub` |
| `REDIS_URL` | 운영 필수, 개발 기본 `redis://localhost:6379/0` | application Redis |
| `STT_AGENT_NAME` | 선택 | 기본 `liveclass-realtime-stt-dev` |
| `STT_HEALTH_HOST`, `STT_HEALTH_PORT` | 선택 | host는 `127.0.0.1` 고정, port는 기본 `8081`이며 `1~65535` 허용 |
| `OPENAI_API_KEY` | OpenAI provider 필수 | OpenAI Realtime WSS 인증 |
| `ASR_MODEL_ID` | Nemotron provider | model ID 또는 로컬 경로 |
| `VLLM_WHISPER_BASE_URL`, `VLLM_WHISPER_MODEL` | vLLM provider 필수 | loopback `/v1` endpoint와 served-model alias |
| `VLLM_API_KEY` | vLLM provider 선택 | 별도 인증 runtime의 Bearer token; 기본 loopback runtime은 비움 |
| `LIVEKIT_TURN_URL`, `LIVEKIT_TURN_SECRET` | TURN 강제 시 | TURN/TCP 연결 |
| `SPRING_STATUS_CALLBACK_ENABLED` | 선택, 기본 `false` | Spring lifecycle callback 활성화 |
| `SPRING_STATUS_CALLBACK_URL`, `AI_CALLBACK_SECRET` | callback 활성 시 필수 | URL과 32-byte 이상 HMAC secret |

`AI_INTERNAL_SECRET`은 Spring↔EC2 ai-api RAG 전용이므로 GPU realtime-agent에는 주입하지 않는다.
realtime-agent의 `AI_CALLBACK_SECRET`도 lifecycle callback을 명시적으로 켠 경우에만 필요하다.

GPU 운영에서는 prod/dev 두 process가 같은 호스트와 LiveKit/TURN tunnel을 공유하되 agent name, Redis와
health port를 분리한다. 기본 prod는 GPU0 tuned Nemotron NeMo, Redis `6390`, health `8081→18081`, active/idle
`5/5`이고 runtime도 독립 model process 5개를 사용한다. dev는 OpenAI Realtime API, Redis `4000`, health `8082→18082`, active/idle `1/1`이다.
realtime control과 TURN은 서로 다른 SSH connection이며 별도 BGE supervisor가 세 번째 connection으로
`18020→8020` reverse forward를 유지한다. 검증된 Whisper checkpoint 전환 시 prod만
`vllm-whisper` active/idle `1/1` profile로 바꾸며 절차는 [ADR-0044](../../docs/decisions/canola/0044-whisper-vllm-runtime-adapter.md)를 따른다.

## 6. 상태 확인

realtime-agent가 직접 만든 loopback HTTP server는 prod process가 `127.0.0.1:8081`, dev process가
`127.0.0.1:8082`에서 상태를 제공한다. FastAPI가 아니며 LiveKit SDK의 자체 HTTP server는 충돌을
피하려고 임의 port를 사용한다.

| endpoint | 성공 조건 |
|---|---|
| `GET /health/live` | server가 응답 가능하면 `200 status=alive` |
| `GET /health/ready` | child 전부 prewarm + AgentServer 시작 + 현재 LiveKit 연결이면 `200 status=ready`, 아니면 `503 status=notReady` |
| `GET /` | 기존 smoke 호환용 `200 OK`; readiness 판단에는 사용하지 않음 |

service readiness는 설정한 warm pool과 LiveKit 연결이 준비됐다는 뜻이다. 특정 dispatch의 session lease,
Redis, room audio, engine queue 또는 capacity 예약은 검사하지 않으므로 job-level readiness gate를
대체하지 않는다. GPU inbound port는 열지 않고 EC2에서는 prod
`http://127.0.0.1:18081`, dev `http://127.0.0.1:18082`로 접근한다. 현재 Spring health client는
구현되지 않았으며 `/worker`는 두 관리 port에서 제공하지 않는다.

## 7. 관련 문서

- [AI 전체 통신 계약](../../docs/ai/CONTRACT.md)
- [realtime-agent 상세 계약](CONTRACT.md)
- [STT→Redis 구조도](ARCHITECTURE.md)
- [프로세스 조립](app/README.md)
- [LiveKit job lifecycle](app/jobs/README.md)
- [STT provider](app/stt/providers/README.md)
- [Redis·Spring adapter](app/adapters/README.md)
- [GPU 배포와 tunnel](deploy/README.md)
- [운영 runbook](../../docs/ai/GPU-REALTIME-AGENT-RUNBOOK.md)
- [service health 결정](../../docs/decisions/canola/0032-realtime-agent-service-health-contract.md)
- [SSH 연결 격리 결정](../../docs/decisions/canola/0033-realtime-agent-ssh-channel-isolation.md)
- [dev/prod 동시 운영 결정](../../docs/decisions/canola/0035-realtime-agent-dual-environment-runtime.md)
- [AI compose·env profile 결정](../../docs/decisions/canola/0036-ai-compose-and-realtime-env-profiles.md)
