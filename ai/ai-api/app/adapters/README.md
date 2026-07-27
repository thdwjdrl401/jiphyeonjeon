# `ai-api/app/adapters`

RAG context core가 외부 Redis, PostgreSQL과 BGE runtime을 사용하는 outbound/inbound adapter다.

| 파일 | 책임 |
|---|---|
| `redis_caption_consumer.py` | 독립 consumer group, owned PEL recovery, handle 후 수동 ACK |
| `pgvector_material_retrieval.py` | `ai_app` role로 ACTIVE lesson chunk만 hybrid 검색 |
| `remote_bge_m3_embedding.py` | 인증된 BGE-M3 query embedding HTTP client |

## 경계와 불변식

- Redis는 application Redis URL을 주입받으며 LiveKit 내부 Redis·host `6380`을 가정하지 않는다.
- poison caption은 계약 위반으로 기록 후 ACK하고, 일시적인 handler 실패는 pending에 남긴다.
- consumer group은 Spring consumer와 분리돼 한쪽 ACK가 다른 쪽 전달을 제거하지 않는다.
- pgvector query는 요청 UUID `lessonId`와 `state='ACTIVE'`를 SQL에서 강제하고 runtime role을 안전한
  identifier로 제한한다.
- BGE 응답은 pinned model/revision, 1024차원, finite unit vector와 단일 입력-출력을 검증한다.
- token, DB URL, 질문 원문과 embedding 값은 로그에 남기지 않는다.
