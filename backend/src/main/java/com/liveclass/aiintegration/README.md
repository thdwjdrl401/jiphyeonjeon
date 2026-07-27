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
- `true`이면 Spring이 기동 중 `ingestion.embed`를 먼저 선언한다. RabbitMQ가 준비되지 않으면 활성화된 서버가
  작업을 받을 수 없도록 기동을 실패시킨다. worker는 이 Spring 소유 큐를 passive lookup한다.
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

## 검증

```powershell
cd backend
.\gradlew.bat test --tests "com.liveclass.aiintegration.*"
```
