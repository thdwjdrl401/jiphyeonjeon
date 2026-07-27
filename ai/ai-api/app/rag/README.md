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
| `service.py` | timeout, scope 재검증, citation, terminal/error 조율 |
| `retrieval.py` | material hit와 최신 caption attempt를 evidence로 결합 |
| `sse.py` | named event와 JSON data framing, iterator cleanup |
| `errors.py` | adapter가 공개 가능한 실패 code만 전달하는 타입 |

## 경계와 불변식

- 모든 evidence는 요청 `lessonId`와 일치해야 하며 caption은 `sessionId`도 일치해야 한다.
- caption citation은 sequence가 다시 시작되는 attempt를 구분하도록 `sttSessionId`를 포함한다.
- 근거가 부족하면 모델을 호출하지 않고 `answer.insufficient` 하나만 낸다.
- 충분한 결과는 중복 제거된 citation을 가진 `answer.done`으로 끝난다.
- timeout과 adapter 오류는 secret·내부 URL을 노출하지 않는 `answer.error`로 끝난다.
- 소비자 취소는 삼키지 않고 retrieval/model iterator까지 전파한다.
- Redis caption과 pgvector/BGE retrieval adapter는 구현됐지만 main lifecycle에는 아직 연결하지 않았다.
- GMS streaming, request 중복 방지와 production wiring은 후속 범위다.
