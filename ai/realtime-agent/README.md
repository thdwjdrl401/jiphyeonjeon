# realtime-agent

LiveKit 강사 microphone을 하나의 streaming STT loop로 처리해 application Redis에 자막 후보를
발행하는 Python agent다. OpenAI Realtime 또는 로컬 Nemotron provider를 선택할 수 있고,
LiveKit `AgentServer` 실행, session lease, caption stream, 선택적인 Spring lifecycle callback까지
연결한다.

외부 메시지 형식은 [CONTRACT.md](CONTRACT.md)와 [`contracts/`](contracts/README.md)에 고정했다.
Spring 공유 경계는 [`docs/CONTRACT.md` §3-3~§3-5](../../docs/CONTRACT.md#3-내부-계약-확정-인터페이스)에 채택됐다.
다만 현재 Java에는 named AgentDispatch, caption consumer, live-agent callback handler가 없으므로
이 서비스만으로 Java 연동 또는 CP2 E2E가 완료됐다고 보지 않는다.

## 처리 흐름

1. LiveKit dispatch metadata의 UUID·필드·크기를 strict 검증한다.
2. assigned room이 정확히 `session-{sessionId}`인지 audio/Redis 사용 전에 확인한다.
3. application Redis에서 session lease를 `SET NX EX`로 얻는다. 중복 job은 engine을 시작하지 않는다.
4. 유일한 remote microphone publisher의 한 track을 한 consumer가 읽는다.
5. provider-neutral STT engine의 한 event consumer가 delta를 Redis Stream에 직접 await해 발행한다.
6. Spring의 room 삭제가 LiveKit `ROOM_DELETED`로 확인될 때만 남은 audio를 drain하고
   `engine.finish()`와 `caption.stream.completed`를 수행한다.
7. lease loss, 다른 disconnect, cancellation, backlog, provider/Redis 오류에서는 신규 completion과
   `SUCCEEDED`를 시작하지 않고 자원을 정리한다. 이미 in-flight인 원격 write 결과는 unknown일 수 있다.

별도 Python stop HTTP API나 Redis stop command는 두지 않는다. Spring이 이미 소유한 LiveKit room
lifecycle과 제어면을 중복시키지 않고 `ROOM_DELETED`를 정상 stop 신호로 사용한다.

## 통신 구조

```mermaid
flowchart LR
    B[강사 브라우저] -->|WebRTC microphone| L[LiveKit SFU]
    S[Spring] -->|Server API: room + explicit dispatch| L
    W[AgentServer parent] <-->|Worker WebSocket: 등록·load·job 배정| L
    W -->|SDK: job child 생성| J[Room job child]
    J <-->|WebRTC: room 참가·audio 구독·ROOM_DELETED| L
    J -->|16 kHz mono PCM| E{STT provider}
    E -->|local process/thread| N[Nemotron on GPU]
    E -->|WSS: 24 kHz PCM + transcript events| O[OpenAI Realtime]
    J -->|SET NX EX + Lua renew/release| R[(Application Redis)]
    J -->|XADD caption.delta/completed| R
    J -.->|HTTP(S) HMAC callback, opt-in| S
```

| 경계 | 방향·protocol | 전달 내용 | 실패·소유권 기준 |
|---|---|---|---|
| dispatch/control | Spring → LiveKit → Worker | agent name, strict metadata, job 배정, worker load | Spring이 dispatch와 timeout을 소유하고 LiveKit이 가용 Worker 하나를 고른다. |
| room media | 브라우저 → LiveKit → job | remote microphone PCM, room lifecycle | job은 assigned Room에만 참가하며 `ROOM_DELETED`만 정상 EOF다. |
| STT | job → provider | provider-neutral `AudioChunk`; transcript delta | Nemotron은 job child의 로컬 GPU 자원이고 OpenAI는 outbound WSS session이다. |
| caption/lease | job → application Redis | session lease, `caption.delta`, `caption.stream.completed` | write timeout은 commit 여부가 unknown일 수 있어 consumer가 `eventId`로 멱등 처리한다. |
| lifecycle | job → Spring, 선택적 | HMAC 서명 상태 callback | Java receiver 채택 전까지 기본 비활성화하며 terminal first-wins를 지킨다. |

LiveKit 내부 Redis와 application Redis는 서로 다른 경계다. 이 agent가 직접 사용하는 `REDIS_URL`은
lease와 caption을 위한 application Redis를 가리켜야 한다. 상세 wire format과 sequence diagram은
[CONTRACT.md](CONTRACT.md), provider별 통신은 [`app/stt/providers/`](app/stt/providers/README.md),
GPU 호스트의 SSH port forwarding은 [`deploy/`](deploy/README.md)를 따른다.

## 안전 경계

- 같은 publisher가 microphone을 여러 개 발행해도 한 track만 선택한다.
- 예상 밖의 두 번째 microphone publisher는 fail-closed 처리한다.
- `chunks()`와 `engine.events()`는 각각 한 consumer만 가질 수 있다. caption mapper는 engine event
  iterator를 다시 소비하지 않는다.
- LiveKit frame은 20 ms로 받고 자체 queue에 최대 250개, 약 5초를 보관한다. 가득 차면 audio를
  버리지 않고 `AudioBacklogError`로 실패한다. 이 수치는 capture backlog 한계이지 전체 pipeline
  latency 상한은 아니다.
- Redis caption `XADD`는 bounded timeout으로 직접 await하고 `MAXLEN ~ 10000`을 기본 적용해
  오래된 엔트리를 근사 trimming한다. `CAPTION_STREAM_MAXLEN`은 양의 엔트리 수로만 조정할 수 있다.
- Redis/HTTP timeout은 remote commit 뒤 응답만 유실된 상태일 수 있다. Redis consumer는 `eventId`,
  callback consumer는 `Idempotency-Key`로 중복을 제거해야 하며 cancellation을 no-write 증거로 보지
  않는다.
- Redis lease는 Lua compare-and-expire/delete로 owner만 갱신·해제한다.
- nonterminal callback은 best-effort다. terminal callback retry는 동일 event ID·timestamp·raw
  body·서명을 재사용하고, timeout 뒤 반대 terminal event를 만들지 않는다.
- completion `XADD`를 시작한 뒤에는 결과가 성공 또는 unknown일 수 있어 새 `FAILED`를 만들지 않는다.
  성공 뒤 callback 구간에서 cancellation/lease loss가 생기면 `SUCCEEDED`가 누락될 수는 있어도 이미
  닫힌 stream을 반대 terminal로 뒤집지 않는다.
- callback은 Java endpoint가 채택되기 전까지 기본 비활성화다.
- Nemotron은 job child마다 model을 하나씩 소유하고 worker당 active job을 최대 12개로 제한한다.
  `STT_NUM_IDLE_PROCESSES` 기본값도 12다. LiveKit Agents 1.6.6이 idle 수를 초기 동시 dispatch의
  reservation 기준으로 사용하기 때문에 12-room burst를 받으려면 active cap과 같아야 한다.
- `ROOM_DELETED`부터 기본 12초 absolute deadline을 drain·cleanup·completion·callback·lease release가
  공유한다. 설정은 최대 13초라 LiveKit Agents 1.6.6의 약 15초 강제 취소 전에 headroom을 남긴다.

`streamElapsedMs`는 realtime-agent가 첫 audio frame을 받은 시점 기준이며 Spring의 session clock이
아니다. Java가 자막을 영속·재생 정렬하기 전에 time-origin 또는 offset 계약을 별도로 채택해야 한다.
`sequence`는 `(sessionId, sttSessionId)` job attempt 범위라 retry마다 1부터 다시 시작할 수 있고,
completion도 동일한 `sttSessionId`를 포함한다.

## provider와 실행 설정

기본 환경 변수 목록은 [`.env.example`](.env.example)에 있다. 코드는 root `.env`를 자동으로 읽지
않으므로 배포 환경에서 명시적으로 주입한다.

로컬 개발에서만 env file이 필요하면 `uv`에 경로를 명시한다. production entrypoint는 env file을
자동 탐색하지 않는다.

```sh
uv run --env-file /path/to/realtime-agent.env --frozen python -m app.main dev
```

필수값:

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- SSH TCP tunnel의 coturn을 강제할 때 `LIVEKIT_TURN_URL`, `LIVEKIT_TURN_SECRET`
- `STT_AGENT_NAME`
- `STT_ENGINE_PROVIDER=stub|openai-realtime|nemotron`
- `REDIS_URL`: LiveKit 내부 Redis가 아닌 application Redis
- `CAPTION_STREAM_MAXLEN`: `XADD MAXLEN ~` 보존 엔트리 수, 기본 `10000`(0으로 비활성화 불가)

`stub`은 local wiring 확인 전용이다. OpenAI provider는 `OPENAI_API_KEY`가 필요하다. Nemotron은
optional CUDA 의존성을 설치하고 `STT_MAX_ACTIVE_JOBS`를 1~12로 설정한다. 생략 시 active 기본값은
Nemotron 12, OpenAI/stub 1이다. `STT_NUM_IDLE_PROCESSES`를 생략하면 Nemotron은 12,
OpenAI/stub은 1을 사용하며 이 값은 active job 수 이하여야 한다. callback을 켤 때만
`SPRING_STATUS_CALLBACK_URL`과 32 byte 이상의 `AI_CALLBACK_SECRET`이 필수다.

GPU 서버와 외부 LiveKit/Redis의 운영·검증 절차는
[`docs/ai/GPU-REALTIME-AGENT-RUNBOOK.md`](../../docs/ai/GPU-REALTIME-AGENT-RUNBOOK.md)를 따른다.

```powershell
uv sync --frozen
uv run --frozen python -m app.main dev
```

production CLI는 같은 환경 변수로 `start` command를 사용한다.

```powershell
uv run --frozen python -m app.main start
```

Nemotron 의존성은 기본 CPU test 환경과 분리한다.

```powershell
uv sync --frozen --extra nemotron
```

## 검증

```powershell
uv lock --check
uv sync --frozen
uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check app tests
uv run --frozen ruff format --check app tests
```

단위 테스트는 fake LiveKit/Redis/HTTP/provider로 race, 직렬화, cleanup을 검증한다. 실제 Redis,
LiveKit, Spring 왕복과 OpenAI credential은 별도 opt-in smoke 증거가 필요하며 기본 test 통과로
대체하지 않는다.

현재 남은 Java 협업 gate:

- `captionEnabled` session에 explicit named AgentDispatch 생성
- 같은 metadata fixture를 사용하는 Java serializer/contract test
- Redis consumer group, 세션 종료 후 정리, event enum과 session clock 변환 확정
- callback URL·HMAC·event ID 멱등·terminal first-wins 처리
- LiveKit·Redis·Spring 정상·실패 E2E와 Java 쪽 계약 테스트

## 폴더별 문서

- [`app/`](app/README.md): 프로세스 조립과 실행 경계
- [`app/jobs/`](app/jobs/README.md): dispatch 검증과 room job 생명주기
- [`app/livekit/`](app/livekit/README.md): LiveKit 오디오 구독 경계
- [`app/audio/`](app/audio/README.md): 오디오 정규화와 분할
- [`app/stt/`](app/stt/README.md): provider-neutral STT 계약과 구현 선택
- [`app/captions/`](app/captions/README.md): STT 이벤트를 자막 이벤트로 변환하는 파이프라인
- [`app/adapters/`](app/adapters/README.md): Redis와 Spring 외부 통신 형식
- [`app/contracts/`](app/contracts/README.md): 상태 콜백 모델과 직렬화
- [`contracts/`](contracts/README.md): AI-side v1 후보 JSON Schema와 fixture
- [`deploy/`](deploy/README.md): GPU 사용자 영역 배포와 SSH 통신 구조
- [`scripts/`](scripts/README.md): 로컬·GPU 검증용 SSH tunnel helper
- [`tests/`](tests/README.md): 단위·계약·생명주기 검증 범위
