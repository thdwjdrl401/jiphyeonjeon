# `ai-api/app/adapters`

RAG context core가 외부 Redis, PostgreSQL과 BGE runtime을 사용하는 outbound/inbound adapter다.

| 파일 | 책임 |
|---|---|
| `redis_caption_consumer.py` | 독립 consumer group, owned PEL recovery, handle 후 수동 ACK |
| `redis_lecture_note_publisher.py` | 강의 노트 추가 조각·수집 완료·정제 snapshot을 결과 Stream에 발행 |
| `redis_conversation_memory.py` | (userId,sessionId,conversationId) → GMS `response_id` TTL 매핑 (ADR-0010, v1 전용) |
| `pgvector_material_retrieval.py` | `ai_app` role로 ACTIVE lesson chunk만 hybrid 검색 |
| `remote_bge_m3_embedding.py` | 인증된 BGE-M3 query embedding HTTP client |
| `gms_openai_answer.py` | 고정 GMS gateway의 grounded OpenAI-compatible 답변 stream (v1) |
| `gms_openai_answer_v2.py` | 같은 GMS gateway를 쓰는 Replay(v2) 답변 stream 어댑터 — v1 코드를 복제해 v1을 안 건드림 |
| `gms_openai_lecture_note.py` | GMS 구조화 JSON 강의 노트 topic 판단과 종료 후 정제 |

## 경계와 불변식

- Redis는 application Redis URL을 주입받으며 LiveKit 내부 Redis·host `6380`을 가정하지 않는다.
- poison caption은 계약 위반으로 기록 후 ACK하고, 일시적인 handler 실패는 pending에 남긴다.
- consumer group은 Spring consumer와 분리돼 한쪽 ACK가 다른 쪽 전달을 제거하지 않는다.
- pgvector query는 요청 UUID `curriculumId`와 `state='ACTIVE'`를 SQL에서 강제하고(ADR-0007) runtime
  role을 안전한 identifier로 제한한다.
- BGE 응답은 pinned model/revision, 1024차원, finite unit vector와 단일 입력-출력을 검증한다.
- token, DB URL, 질문 원문과 embedding 값은 로그에 남기지 않는다.
- GMS prompt에는 질문과 선택된 근거·최소 citation 좌표만 넣고 request/session/material/attempt ID를 제외한다.
- GMS SDK retry는 0으로 두고 timeout·rate limit·인증·설정 실패를 공개 가능한 고정 code로 바꾼다.
- `gms_openai_answer.py`는 `response_id_capture`가 주어질 때만 Chat Completions 대신 GMS Responses
  API(`/responses`, `previous_response_id` 체이닝)를 쓴다 — 그 kwarg가 없는 모든 기존 호출은 원래
  경로 그대로다(ADR-0010). `userId`/`conversationId`는 provider에 보내지 않고 Redis 조회 키로만 쓴다.
- 라이브 강의 노트 모델에는 현재 topic·직전 topic·이전 문맥·새 window만 전달한다.
- 종료 후 정제 모델에는 raw caption이 아닌 현재 구조화 draft topic만 한 번 전달한다.
- provider delta는 SSE data 제한에 맞춰 최대 10,000자로 다시 자르고 취소 시 provider stream을 닫는다.
