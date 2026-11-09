# ai-api

## 1. 이 서비스가 하는 일

`ai-api`는 EC2에서 실행되는 Spring 전용 FastAPI 서비스다. 강의 자료와 실시간 자막을 검색하고,
GMS가 생성한 RAG 답변을 SSE로 전달하며 실시간 자막에서 축적형 강의 노트 조각을 만든다.
브라우저가 직접 호출하는 공개 API는 제공하지 않는다.

기본 주소는 `http://127.0.0.1:8010`이다.

## 2. 누가 어떻게 호출하는가

| 호출자 | 대상 | 통신 | 용도 |
|---|---|---|---|
| Spring | `POST /internal/v1/rag/answers:stream` | HTTP + SSE, HMAC | RAG 질문과 답변 스트림(Live) |
| Spring | `POST /internal/v2/rag/answers:stream` | HTTP + SSE, HMAC | RAG 질문과 답변 스트림(다시보기, ADR-0042) |
| 운영 환경 | `GET /healthz`, `GET /readyz` | HTTP | 프로세스 생존·lifespan 준비 확인 |
| realtime-agent → Redis → ai-api | `ai:captions:live` | Redis Stream consumer group | 실시간 자막 입력·처리 후 ACK |
| ai-api → Redis | `ai:lecture-notes:mvp` | Redis Stream | 강의 노트 추가 조각·수집 완료·정제 snapshot event |
| ai-api | bge-runtime `POST /internal/v1/embeddings` | HTTP, Bearer | 질문 embedding 생성 |
| ai-api | PostgreSQL `ai` schema | SQL/pgvector | 활성 강의 자료 검색 |
| ai-api | GMS OpenAI-compatible API | HTTPS | 근거 기반 답변 생성 |

Spring의 RAG 호출부(`RagAnswerHttpClient`)와 서명 발급기(`RagInternalSigner`)는 구현돼 있다
(`backend/src/main/java/com/liveclass/aiintegration/`). 현재 endpoint는 `AI_INTERNAL_SECRET`이
없으면 `503`으로 닫힌다. 주소·인증·구현 상태의 기준은
[`docs/ai/CONTRACT.md`](../../docs/ai/CONTRACT.md)를 따른다.

FastAPI가 자동 생성하는 `/docs`, `/redoc`, `/openapi.json`은 개발 편의 기능이며 서비스 통신 계약이 아니다.

## 3. 통신 예시

Spring은 JSON 원문 전체의 HMAC-SHA256 값을 `X-Internal-Signature`로 보낸다.

```http
POST /internal/v1/rag/answers:stream HTTP/1.1
Accept: text/event-stream
Content-Type: application/json
X-Internal-Signature: <base64-hmac-signature>

{
  "requestId": "request-1",
  "lessonId": "11111111-1111-4111-8111-111111111111",
  "curriculumId": "55555555-5555-4555-8555-555555555555",
  "sessionId": "33333333-3333-4333-8333-333333333333",
  "question": "방금 설명한 개념은 무엇인가요?",
  "contextTimeMs": 615000,
  "issuedAtMs": 1785120000000
}
```

응답은 0개 이상의 delta 이후 하나의 terminal event로 끝난다.

```text
event: answer.delta
data: {"requestId":"request-1","text":"RAG는 "}

event: answer.done
data: {"requestId":"request-1","sources":[{"type":"PPTX","materialId":"22222222-2222-4222-8222-222222222222","page":4}]}
```

v1 요청에 optional `userId`를 추가로 실으면 GMS Responses API로 이전 turn을 이어간다(ADR-0010).
대화의 기본 범위는 그 사용자의 라이브 세션이며 optional `conversationId`는 이 범위를 더 좁힐 때만
쓴다(ADR-0046). Spring은 `userId`를 보내고(`RagAnswerHttpClient`) `conversationId`는 아직 보내지 않으므로, 대화 범위는 그 사용자의 그 라이브 세션이다.

다시보기(Replay) 질문은 별도 경로 `POST /internal/v2/rag/answers:stream`을 쓴다. 시간 필드가
`contextTimeMs`(STT attempt-local) 대신 `context.questionSessionMs`(세션 상대 ms)이고, Spring이 이미
계산한 확정 자막을 `context.captions[]`로 함께 보낸다.

```json
{
  "requestId": "request-1",
  "lessonId": "22222222-2222-4222-8222-222222222222",
  "curriculumId": "55555555-5555-4555-8555-555555555555",
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "question": "여기서 말한 consumer group이 뭐야?",
  "context": {
    "mode": "REPLAY",
    "questionSessionMs": 735000,
    "captions": [
      {"sttSessionId": "stt-attempt-2", "segmentIndex": 42, "startSessionMs": 711200, "endSessionMs": 716800, "text": "컨슈머 그룹은 여러 소비자가 메시지를 분담해서 처리하도록 합니다."}
    ]
  },
  "issuedAtMs": 1785450000000
}
```

응답 `answer.done.sources`는 v1과 달리 원문 그대로의 `excerpt`(최대 300자)를 포함하고, CAPTION source는
`sttSessionId` 없이 `sessionId`/`startSessionMs`/`endSessionMs`만 담는다.

```text
event: answer.done
data: {"requestId":"request-1","sources":[{"type":"CAPTION","sessionId":"11111111-1111-4111-8111-111111111111","startSessionMs":711200,"endSessionMs":716800,"excerpt":"컨슈머 그룹은 여러 소비자가 메시지를 분담해서 처리하도록 합니다."}]}
```

전체 요청 필드, SSE event, 상태코드는 [`CONTRACT.md`](CONTRACT.md)에서 확인한다.

## 4. 처리 흐름

```text
Redis caption Stream → background consumer → in-memory caption store

Spring
  → ai-api → bge-runtime 질문 embedding
  → PostgreSQL 활성 자료 검색
  → in-memory 최근 자막 조회
  → GMS 답변 생성
  → SSE answer.delta / terminal event
  → Spring
```

`ai-api`는 시작할 때 강의 노트 checkpoint를 복원한 뒤, 같은 caption Stream을 서로 다른 group으로 읽는
RAG consumer와 강의 노트 consumer를 실행한다. 서로 다른 group이므로 한쪽 ACK가 다른 쪽 전달을 제거하지 않는다. 자료와 자막에서
충분한 근거를 찾지 못하면 GMS를 호출하지 않고 `answer.insufficient`로 종료한다.

강의 노트 live 출력은 `lecture.note.chunk.appended` 추가분과 `lecture.note.capture.completed`를 발행하고,
종료 후 정제 결과만 `lecture.note.refined.snapshot` 전체본으로 `ai:lecture-notes:mvp`에 발행한다.
wire 필드·길이·순서·멱등·ACK 규칙의 정본은
[공유 계약 §3-4a](../../docs/CONTRACT.md#3-4a-ai-api--application-redis-실시간-강의-노트-stream--ai-producerspring-consumer-구현소비-스위치-lecture_note_consumer_enabled-기본-off)다.
강의 노트 caption은 Redis session checkpoint 저장 뒤 ACK하며, 결과 event와 다음 checkpoint는 같은 Redis
transaction으로 확정한다. Spring consumer·DB·REST·WebSocket과 FE 소비까지 구현됐지만 Spring consumer는
`LECTURE_NOTE_CONSUMER_ENABLED`(기본 `false`)로 닫혀 있다.

## 5. 실행과 설정

```bash
cd ai/ai-api
uv sync --frozen
uv run --frozen --env-file ../.env python -m app.main
```

로컬 설정은 [`ai/.env.example`](../.env.example)을 `ai/.env`로 복사하고 빈
`AI_API_GMS_API_KEY`와 필요한 secret을 채워 사용한다.

| 환경변수 | 필요 조건 | 용도 |
|---|---|---|
| `AI_API_DATABASE_URL` | 실행 필수 | PostgreSQL `ai` schema 연결 |
| `AI_API_BGE_BASE_URL`, `AI_API_BGE_TOKEN` | 실행 필수 | bge-runtime 주소와 Bearer token |
| `AI_API_GMS_API_KEY` | 실행 필수 | GMS 답변 모델 인증 |
| `AI_API_REDIS_URL` | 선택 | 자막 Redis 연결, 기본값 `redis://127.0.0.1:6379/0` |
| `AI_API_INSTANCE_ID` | 운영 권장 | Redis consumer name 충돌 방지. EC2의 ai-api replica마다 고유해야 함 |
| `AI_API_LECTURE_NOTE_*` | 선택 | 강의 노트 window·모델·Stream 한도 조정 |
| `AI_API_LECTURE_NOTE_MODEL` | 선택 | 기본 `gpt-5-mini`(ADR-0081). 비우면 `AI_API_GMS_MODEL` 사용 |
| `AI_API_LECTURE_NOTE_REASONING_EFFORT` | 선택 | 기본 `minimal`. adapter가 모델 이름으로 sampling knob을 고르므로 비-reasoning 모델(gpt-4.1 등)에서는 이 값이 무시된다 |
| `AI_API_CONVERSATION_MEMORY_TTL_SECONDS` | 선택 | v1 대화 이어가기 TTL(초), 기본 1,800 — ADR-0010 |
| `AI_API_CONVERSATION_MEMORY_KEY_PREFIX` | 선택 | 대화 이어가기 Redis key prefix, 기본 `ai:conversation:` |
| `AI_INTERNAL_SECRET` | RAG 호출 필수 | Spring 요청 HMAC 검증용 공유 secret; GPU에서는 사용하지 않음 |

기본 host와 port는 `AI_API_HOST=127.0.0.1`, `AI_API_PORT=8010`이다. 운영 compose는 같은 Docker
network의 Spring이 접근할 수 있도록 container 내부 bind만 `0.0.0.0:8010`으로 바꾼다.

| 실행 형태 | `AI_API_BGE_BASE_URL` | token 주입 |
|---|---|---|
| 로컬 runtime | `http://127.0.0.1:8020` | `AI_API_BGE_TOKEN` |
| EC2 host process | `http://127.0.0.1:18020` | `AI_API_BGE_TOKEN` |
| EC2 운영 container | `http://liveclass-bge-runtime-cpu:8020`(compose 기본값, `BGE_RUNTIME_URL`로 덮어씀) | root `BGE_RUNTIME_INTERNAL_TOKEN` → `AI_API_BGE_TOKEN` |
운영 root env의 `GMS_API_KEY`는 compose에서 container의 `AI_API_GMS_API_KEY`로 매핑한다.
backend와 GPU 서비스에는 이 값을 주입하지 않는다.

강의 노트 MVP는 Redis session checkpoint로 프로세스 재시작을 복구하지만 session owner fencing은 없으므로
운영 ai-api는 단일 replica로 띄운다. 같은 EC2의 Spring, Redis, ai-worker와 함께 실행해도 별도 port를
사용하지 않으며 application Redis key와 consumer group만 공유한다.

경로 prefix가 있는 BGE URL은 허용하지만 credential, query, fragment와 `..` 경로는 거부한다.
`AI_INTERNAL_SECRET`은 이름이 바뀐 값이 아니며 Spring↔ai-api 전용이다. ai-api 검증기와 Spring signer
(`RagInternalSigner`)·SSE proxy(`RagAnswerRelay`)는 모두 구현돼 있다.

## 6. 상태 확인

| endpoint | 의미 |
|---|---|
| `GET /healthz` | FastAPI 프로세스가 응답할 수 있음 |
| `GET /readyz` | application lifespan이 시작됨 |

`/readyz`는 Redis, PostgreSQL, bge-runtime, GMS의 연결 상태까지 검사하지 않는다.

## 7. 관련 문서

- [AI 전체 통신 계약](../../docs/ai/CONTRACT.md)
- [ai-api 상세 계약](CONTRACT.md)
- [애플리케이션 구조](app/README.md)
- [RAG 구조](app/rag/README.md)
- [강의 노트 MVP 구조](app/lecture_notes/README.md)
- [자료 검색 구조](app/retrieval/README.md)
- [자막 문맥 구조](app/captions/README.md)
- [ai-api 결정 기록](docs/README.md)
- [EC2 AI 운영 compose](../../docker-compose.ai-prod.yml)
- [EC2 AI 운영 환경변수](../../.env.ai-prod.example)
