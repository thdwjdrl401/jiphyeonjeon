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
| `retrieval.py` | material hit와 최신 caption attempt를 evidence로 결합 |
| `sse.py` | named event와 JSON data framing, iterator cleanup |
| `errors.py` | adapter가 공개 가능한 실패 code만 전달하는 타입 |

## 경계와 불변식

- PPTX evidence는 요청 `curriculumId`와 일치해야 한다(ADR-0005, curriculum 전체 공유). caption
  evidence는 지금처럼 `lessonId`·`sessionId`가 모두 일치해야 한다 — 실시간 자막은 공유하지 않는다.
- caption citation은 sequence가 다시 시작되는 attempt를 구분하도록 `sttSessionId`를 포함한다.
- 근거가 부족하면 모델을 호출하지 않고 `answer.insufficient` 하나만 낸다.
- 충분한 결과는 중복 제거된 citation을 가진 `answer.done`으로 끝난다.
- timeout과 adapter 오류는 secret·내부 URL을 노출하지 않는 `answer.error`로 끝난다.
- 소비자 취소는 삼키지 않고 retrieval/model iterator까지 전파한다.
- Redis caption과 pgvector/BGE retrieval adapter는 구현됐지만 main lifecycle에는 아직 연결하지 않았다.
- client 취소·오류·terminal 모두 request lease를 recent 상태로 옮겨 같은 ID의 재사용을 막는다.
- GMS streaming과 context consumer lifecycle은 연결했지만 Spring 인증이 채택되기 전 production API는 닫혀 있다.
- multi-replica registry와 재연결 replay 정책은 후속 범위다.
