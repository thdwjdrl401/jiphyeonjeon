# `backend/aiintegration`

강사 자료 연결을 신뢰성 있게 AI worker로 전달하고 결과 callback을 받는 Spring 경계다. 공유 JSON 필드와
상태코드의 정본은 [`docs/CONTRACT.md` §3](../../../../../../../docs/CONTRACT.md)이며, 이 문서는 코드가 실제로
연결되는 순서와 운영 gate만 설명한다.

## 파이프라인

```text
강사 PPTX 연결
  -> core.outbox_events (자료 변경과 같은 DB transaction)
  -> RabbitMQ ingestion.embed (default exchange, durable queue)
  -> ai-worker: 주문형 URL 발급 -> PPTX -> BGE-M3 -> pgvector
  -> POST /api/internal/ai/callbacks
  -> embeddingStatus READY 또는 FAILED
```

- `MATERIAL_EMBEDDING_ENABLED=false`가 기본값이다. 이때 자료 연결은 기존 동작을 보존해 즉시 `READY`가 되고
  outbox job을 만들지 않는다.
- Spring의 `Queue` 빈은 RabbitAdmin이 broker에 처음 연결할 때 `ingestion.embed`를 선언한다. 발행 전용이라
  기본은 기동 중 broker 연결을 강제하지 않지만, `MATERIAL_EMBEDDING_ENABLED=true`이면
  `IngestionQueueInitializer`가 기동 시(`ApplicationReadyEvent`) 큐 선언을 앞당긴다(브로커 미가동 시 비치명적).
  따라서 스위치가 켜진 배포에서는 worker를 첫 발행보다 먼저 시작해도 되고, 인프라가 큐를 미리 만들 필요가 없다.
- outbox relay는 default exchange에 routing key `ingestion.embed`로 발행한 뒤에만 event를 `PUBLISHED`로
  바꾼다. 실패는 DB에 기록하고 지수 backoff한다.
- worker는 메시지의 `assetId`로 `POST /api/internal/ai/materials/download-url`을 호출한다. Spring과 worker는
  `AI_CALLBACK_SECRET`으로 raw body HMAC-SHA256을 검증하며 worker에 MinIO/S3 자격증명을 주지 않는다.
- 완료 callback은 `(source, eventId)`로 멱등 처리하며 `MATERIAL_EMBEDDED`는 `READY`,
  `MATERIAL_EMBED_FAILED`는 `FAILED`로 전이한다.
- 현재 실제 활성화 범위는 `PPTX_EMBED` happy path다. `EMBED_DELETE`는 worker resolver가 보강되기 전까지
  DLQ 보존 대상으로 취급한다.

AI worker의 ACK/retry/DLQ·저장 경계는
[`ai/ai-worker/README.md`](../../../../../../../ai/ai-worker/README.md)에 있다.

## 다시보기 RAG 요구사항

다시보기 영실이는 아직 구현되지 않았다. 필요한 공개/내부 endpoint와 시간·근거 데이터는
[`ADR-0037`](../../../../../../../docs/decisions/canola/0037-replay-ai-caption-context-contract.md)에 정리돼
있으며, 내부 구현 방법은 Spring·AI 오너가 합의해 결정한다.

## 검증

```powershell
cd backend
.\gradlew.bat test --tests "com.liveclass.aiintegration.*"
```
