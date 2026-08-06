# `ai-api/app/rag`

HTTP, Redis, PostgreSQL, BGE, GMS를 모르는 RAG 답변 application core다.

## 흐름

```text
RagAnswerRequest
  -> EvidenceRetriever.retrieve()
  -> insufficient 또는 scope 검증된 evidence
  -> AnswerModel.stream_answer()
  -> answer.delta* + terminal 1개
```

## 파일 구성

| 파일 | 책임 |
|---|---|
| `models.py` | camelCase 요청/SSE event와 내부 evidence 모델 |
| `ports.py` | 근거 검색·답변 모델 port |
| `service.py` | request lease, timeout, scope 재검증, citation, terminal/error 조율 |
| `registry.py` | active/recent requestId의 bounded process-local registry |
| `retrieval.py` | material hit와 최신 caption attempt를 evidence로 결합(`CombinedEvidenceRetriever`); Replay는 요청에 실린 caption을 재조회 없이 병합(`ReplayEvidenceRetriever`) |
| `sse.py` | named event와 JSON data framing, iterator cleanup |
| `errors.py` | adapter가 공개 가능한 실패 code만 전달하는 타입 |
| `replay_service.py` | Replay(v2) request lease, timeout, scope 재검증, excerpt 포함 citation dedup, terminal/error 조율 |

`ports.py`의 `ResponseIdCapture`/`ConversationMemoryPort`는 v1 전용 대화 이어가기(ADR-0010)
용 타입이며 아래 절 참고.

## 경계와 불변식

- PPTX evidence는 요청 `curriculumId`와 일치해야 한다(ADR-0007, curriculum 전체 공유). caption
  evidence는 지금처럼 `lessonId`·`sessionId`가 모두 일치해야 한다 — 실시간 자막은 공유하지 않는다.
- caption citation은 sequence가 다시 시작되는 attempt를 구분하도록 `sttSessionId`를 포함한다.
- 근거가 부족하면 모델을 호출하지 않고 `answer.insufficient` 하나만 낸다.
- 충분한 결과는 중복 제거된 citation을 가진 `answer.done`으로 끝난다.
- timeout과 adapter 오류는 secret·내부 URL을 노출하지 않는 `answer.error`로 끝난다.
- 소비자 취소는 삼키지 않고 retrieval/model iterator까지 전파한다.
- Redis caption과 pgvector/BGE retrieval adapter는 `wiring.py`를 거쳐 main lifecycle에 연결돼 있다.
- client 취소·오류·terminal 모두 request lease를 recent 상태로 옮겨 같은 ID의 재사용을 막는다.
- GMS streaming과 context consumer lifecycle은 연결했고, production API는 `AI_INTERNAL_SECRET`이 없을 때만 닫혀 있다.
- multi-replica registry와 재연결 replay 정책은 후속 범위다.

## 다시보기 RAG (v2)

`POST /internal/v2/rag/answers:stream`(`api/rag.py`의 `create_rag_router_v2`)은 v1과 별도 경로로
Replay 질문을 처리한다. 요구사항은 [`ADR-0042`](../../../../docs/decisions/canola/0042-replay-ai-caption-context-contract.md),
구현 설계는 [`ADR-0008`](../../../../docs/decisions/jinwoo/0008-replay-rag-answer-v2-endpoint.md)에 있다.

- `ReplayEvidenceRetriever`는 PPTX Top K는 v1과 동일한 `MaterialRetrievalPort`로 검색하고, caption은
  요청의 `context.captions[]`를 재조회 없이 하나로 병합해 CAPTION source 최대 1개만 만든다.
- `ReplayAnswerService`(`replay_service.py`)는 v1 `RagAnswerService`의 timeout·registry·SSE 골격을
  import로 재사용하되, v1 타입에 고정된 evidence-scope 검증과 citation dedup만 v2 타입으로 새로 만든다
  — v1 `service.py`는 이 작업으로 한 줄도 바뀌지 않는다(이유는 ADR-0008 "구현 중 조정" 참고).
- `answer.done.sources`에는 v1에 없는 plain-text `excerpt`(최대 300자, 원문 그대로)가 붙는다. dedup 키는
  `(materialId,page)` / `(sessionId,startSessionMs,endSessionMs)`이며 `excerpt` 차이는 무시한다.
- `GmsOpenAIAnswerModelV2`(`app/adapters/gms_openai_answer_v2.py`)도 같은 이유로 v1 어댑터를 복제한
  별도 클래스다 — 모델에는 `excerpt`가 아니라 v1과 동일하게 전체 `content`만 보낸다.

## 대화 이어가기 (v1, ADR-0010)

`RagAnswerRequest`에 optional `userId`/`conversationId`가 있고, `userId`만 있어도
`RagAnswerService`가 대화 기억을 활성화한다(ADR-0046). `conversationId`가 없으면 그 사용자의
`sessionId` 범위를 기본 대화로 삼고, 있으면 그 범위를 더 좁힌다. 활성화되면
`ConversationMemoryPort`(구현체는
`app/adapters/redis_conversation_memory.py`의 `RedisConversationMemoryStore`)로 이전
GMS `response_id`를 조회해 `AnswerModel.stream_answer(..., previous_response_id=..., 
response_id_capture=...)`로 넘긴다. 이 두 kwargs가 없으면 `GmsOpenAIAnswerModel`은 기존 Chat
Completions 경로를 그대로 타므로, `userId`를 안 보내는 모든 기존 호출은 동작이
전혀 안 바뀐다. Redis 조회·저장 실패는 로그만 남기고 답변은 항상 정상 진행한다(fail-open). 자세한
설계·실측 검증은 [`ADR-0010`](../../../../docs/decisions/jinwoo/0010-gms-responses-api-conversation-memory.md) 참고.
