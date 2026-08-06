# `ai-api/app/lecture_notes`

실시간 caption을 주제별 Markdown 강의 노트로 축적하는 ai-api 내부 MVP core다. 정책과 단계별 판단은
[ADR-0034](../../../../docs/decisions/canola/0034-near-realtime-accumulative-lecture-notes.md), 실행과 EC2
구성은 [ai-api README](../../README.md)를 기준으로 한다.

## 흐름

```text
ai:captions:live
  -> ai-live-notes-mvp-v1
  -> window accumulator + Redis session checkpoint
  -> GMS structured JSON
  -> topic reducer + Markdown renderer
  -> Redis outbox transaction + append event Stream
  -> capture completed -> GMS draft refinement -> refined snapshot
```

RAG consumer group `ai-rag-live-v1`과 별도 group을 사용하므로 서로의 ACK에 영향을 주지 않는다. ai-api
lifecycle은 checkpoint restore를 끝낸 뒤 consumer를 시작하며 별도 process나 port는 만들지 않는다.
caption은 session checkpoint 저장 뒤 ACK하고, 모델 결과는 outbox 저장 뒤 결과 `XADD`와 다음 checkpoint를
한 Redis transaction으로 확정한다. 같은 세션의 모델 호출은 ai-api 내부에서 직렬화한다.
재시작 시 고정 consumer가 자기 pending entry를 먼저 모두 처리한다. 그 뒤에도
`completed=true`, `completionAcked=false`인 복원 checkpoint는 이전 프로세스가 XACK 직후 종료된 경우로
간주해 ACK 완료를 확정한다. 이 판단은 단일 replica와 고정 consumer name 전제에서만 유효하다.

재시작 상태는 다음 두 key가 소유한다.

- `ai:lecture-notes:mvp:state:{sessionId}`: partial text, 역할 기반 draft, 발행 note, 순번, pending/in-flight, outbox
- `ai:lecture-notes:mvp:active-sessions`: 시작 시 복원할 session ID 색인

현재 [EC2 Compose](../../../../docker-compose.ai-prod.yml)는 ai-api 단일 replica를 전제로 한다. transaction은
application Redis 단일 인스턴스를 전제로 하며 Redis 자체 장애 내구성과 여러 replica의 session owner는
아직 보장하지 않는다.

## Redis 결과와 확인

- 추가 노트 조각: `lecture.note.chunk.appended`
- caption 수집 완료: `lecture.note.capture.completed`
- 종료 후 전체 정제본: `lecture.note.refined.snapshot`
- 결과 Stream: `ai:lecture-notes:mvp` (`XADD MAXLEN ~`, 기본 10,000개)

Redis event의 정본은 [공유 계약 §3-4a](../../../../docs/CONTRACT.md#3-4a-ai-api--application-redis-실시간-강의-노트-stream--ai-producerspring-consumer-구현소비-스위치-lecture_note_consumer_enabled-기본-off)다.
AI는 live 중 내부 topic 상태를 모델 문맥과 중복 제거에 사용하고 Redis에는 새 `markdownFragment`와
구조화 요점만 발행한다. capture 완료 뒤 현재 구조화 draft만 한 번 정제해 별도 전체 snapshot을 발행한다.
Spring consumer(`LectureNoteStreamConsumer`)·DB(`core.live_lecture_note`)·REST
(`GET /api/live-sessions/{sessionId}/notes`)·WebSocket(`/topic/live-sessions/{sessionId}/notes`)은
구현됐으나, consumer는 `LECTURE_NOTE_CONSUMER_ENABLED`(기본 `false`)로 꺼져 있다.

내부 draft는 A안 6타입 `DEFINITION|FACT|MECHANISM|PROCEDURE|EXAMPLE|CAUTION`을 사용한다. GMS는
현재 활성 topic 전체 snapshot을 반환하고 ai-api는 이를 checkpoint에 저장해 다음 window에 다시 전달한다.
Redis의 기존 append 계약은 바꾸지 않으며 새로 추가·변경된 item을 최대 3개 요점으로 묶어 발행한다.
라이브 event에 싣지 못한 item도 draft에는 남고 종료 정제 입력에는 전체가 포함된다.

정제 모델 호출이나 결과 발행이 실패하면 `refinementPending` 또는 outbox checkpoint를 유지한다. 현재
일시적인 GMS 연결·상태 오류는 bounded retry하고 draft schema·전이 위반은 한 번 재작성한다. 그래도
실패하거나 결과 발행이 실패하면 checkpoint를 유지해 ai-api 재시작 때 이어서 처리한다. 최종 실패 상태와
실패 window 자동 복구는 후속 범위다.

refined snapshot 발행과 caption completion ACK가 모두 끝나면 Redis checkpoint와 Python의 전체 세션
상태를 해제한다. 같은 `sessionId`의 늦은 caption으로 세션이 다시 살아나지 않도록 accumulator에는 크기가
제한된 완료 tombstone만 남긴다. GMS 전역 동시성·우선순위·재시도 정책은
[ADR-0038](../../../../docs/decisions/canola/0038-lecture-note-session-reclamation-and-gms-concurrency.md)을 따른다.

GMS adapter 앞의 process-local admission gate는 전체 호출 4개, refinement 1개를 기본 상한으로 두고 live
작업을 우선한다. 연속 live 8개 뒤에는 대기 중인 refinement를 받아 starvation을 막는다. 429·408·409,
일시적 5xx와 연결/timeout 오류만 최대 3회 재시도하며 backoff 중에는 slot을 반납한다. 조정값은
`AI_API_LECTURE_NOTE_GMS_*` 환경변수로 주입한다. 여러 ai-api replica에서 공유되는 분산 상한은 아니다.
운영 확인에는 `BoundedLectureNoteModel.metrics_snapshot()`의 `in_flight`, `queued_live`,
`queued_refinement`, `wait_ms_p50/p95`, `retries_total`, `failures_total`을 사용한다.

모델의 내부 action은 `IGNORE|UPDATE_CURRENT|START_NEW`다. `IGNORE`는 operation만 완료하고 출력
event와 `chunkSequence`를 만들지 않는다. `UPDATE_CURRENT`는 활성 topic snapshot을 교체한 뒤 새로
추가·변경된 item이 있을 때만 wire의 `CONTINUE`로 변환한다. `START_NEW`는 이전 topic을 확정하고 새 활성
topic을 만들며 wire의 `START_NEW`로 변환한다.

Redis에 접속한 뒤 다음 값으로 생성 여부와 갱신 상태를 확인한다.

```bash
redis-cli XREVRANGE ai:lecture-notes:mvp + - COUNT 10
redis-cli SMEMBERS ai:lecture-notes:mvp:active-sessions
```

[공통 ai-api 검증 명령](../README.md#검증)은 unit·integration test와 lint를 함께 실행한다. 실제 Redis
integration test는 기본 `redis://127.0.0.1:6379/15`를 사용하며 `AI_API_TEST_REDIS_URL`로 바꿀 수 있다.

prompt v1/v2는 같은 8개 한국어 경계 샘플로 비교한다. `AI_API_GMS_API_KEY`가 있는 환경에서 실행하면
action 일치, 과분할, 유효 내용 무시 횟수와 case별 결과를 JSON으로 출력한다.

```bash
uv run --frozen --env-file ../.env python -m scripts.evaluate_lecture_note_prompts
```

이 결과에서 실제 `START_NEW` 과분할이 확인될 때만 한 window topic 전환 확인을 추가한다. 현재는 라이브
지연을 늘리는 전환 보류를 구현하지 않았다.

정보 타입 수는 수학·역사·기술·과학·인문·노이즈 STT·언어·통계의 고정 8개 샘플로 상세 6타입과 최소
4타입을 비교했다. 상세 6타입이 4승, 최소 4타입이 3승, 1무였고 최소 타입은 item 수를 줄이지 못하면서
예시·예외 누락이 확인됐다. 따라서 A안 상세 6타입만 runtime에 남기고 비교용 C안 구현은 제거했다.
Redis 계약은 변경하지 않는다. 비교 결과와 확정 조건은
[ADR-0034](../../../../docs/decisions/canola/0034-near-realtime-accumulative-lecture-notes.md)를 따른다.

## 현재 비범위

- Spring·Frontend가 소비하는 API/DTO와 DB 영속화
- Redis 자체 장애 내구성, multi-replica session owner, 다른 consumer의 pending claim
- LLM 최종 실패 상태·실패 window 복구와 VOD 기반 최종 교정·강사 검수

전체 비범위와 다음 완료 조건은 [ADR-0034의 MVP 범위와 검증](../../../../docs/decisions/canola/0034-near-realtime-accumulative-lecture-notes.md#mvp에서-하지-않는-것)을 따른다.
