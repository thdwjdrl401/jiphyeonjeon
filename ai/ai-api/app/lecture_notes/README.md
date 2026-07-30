# `ai-api/app/lecture_notes`

실시간 caption을 주제별 Markdown 강의 노트로 축적하는 ai-api 내부 MVP core다. 정책과 단계별 판단은
[ADR-0034](../../../../docs/decisions/canola/0034-near-realtime-accumulative-lecture-notes.md), 실행과 EC2
구성은 [ai-api README](../../README.md)를 기준으로 한다.

## 흐름

```text
ai:captions:live
  -> ai-live-notes-mvp-v1
  -> window accumulator
  -> GMS structured JSON
  -> topic reducer + Markdown renderer
  -> Redis append event Stream
```

RAG consumer group `ai-rag-live-v1`과 별도 group을 사용하므로 서로의 ACK에 영향을 주지 않는다. ai-api
lifecycle이 consumer를 함께 시작하며 별도 process나 port는 만들지 않는다. 노트 상태와 모델 호출 직렬화가
in-memory이므로 [EC2 Compose](../../../../docker-compose.ai-prod.yml)는 ai-api를 단일 replica로 운용한다.

## Redis 결과와 확인

- 추가 노트 조각: `lecture.note.chunk.appended`
- caption 수집 완료: `lecture.note.capture.completed`
- 결과 Stream: `ai:lecture-notes:mvp` (`XADD MAXLEN ~`, 기본 10,000개)

Redis event의 정본은 [공유 계약 §3-4a](../../../../docs/CONTRACT.md#3-4a-ai-api--application-redis-실시간-강의-노트-stream--ai-producer-구현-spring-consumer-미구현)다.
AI는 내부 topic 상태를 모델 문맥과 중복 제거에 사용하지만 Redis에는 새 `markdownFragment`와 구조화
요점만 발행한다. Spring consumer·DB·REST·WebSocket은 아직 미구현이다.

Redis에 접속한 뒤 다음 값으로 생성 여부와 갱신 상태를 확인한다.

```bash
redis-cli XREVRANGE ai:lecture-notes:mvp + - COUNT 10
```

[공통 ai-api 검증 명령](../README.md#검증)은 unit·integration test와 lint를 함께 실행한다. 실제 Redis
integration test는 기본 `redis://127.0.0.1:6379/15`를 사용하며 `AI_API_TEST_REDIS_URL`로 바꿀 수 있다.

## 현재 비범위

- Spring·Frontend가 소비하는 API/DTO와 DB 영속화
- multi-replica session owner, 다른 consumer의 pending claim, 재시작 복원
- LLM retry·실패 window 복구와 VOD 기반 최종 교정·강사 검수

전체 비범위와 다음 완료 조건은 [ADR-0034의 MVP 범위와 검증](../../../../docs/decisions/canola/0034-near-realtime-accumulative-lecture-notes.md#mvp에서-하지-않는-것)을 따른다.
