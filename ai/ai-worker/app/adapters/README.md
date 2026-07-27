# `ai-worker/app/adapters`

PostgreSQL/pgvector와 RabbitMQ, Spring material capability, remote BGE adapter를 둔다.

## 역할

- `ai` schema에 shadow material version과 chunk/embedding을 transaction으로 저장한다.
- advisory lock, idempotency, version 역행 방지와 단일 ACTIVE 전환을 강제한다.
- vector를 unit norm으로 저장하고 material scope 변경을 거부한다.
- Spring HMAC으로 단명 다운로드 URL과 완료 callback을 주고받는다.
- BGE-M3 HTTP 입력 순서를 보존하고 RabbitMQ ACK/retry/DLQ를 관리한다.

## 구조와 흐름

```text
RabbitMaterialConsumer -> MaterialJobHandler
SpringPresignedPptxAssetStore -> Spring/MinIO
RemoteBgeM3EmbeddingModel -> bge-runtime
IndexStorage -> PgvectorIndexRepository -> PostgreSQL ai schema
```

## 파일 구성

`pgvector_index.py`, `rabbitmq_material_consumer.py`, `spring_material_*`,
`remote_bge_embedding.py`가 외부 경계를 구현한다.

## 경계와 불변식

- `SET LOCAL ROLE ai_app`과 Python 소유 schema만 사용한다.
- worker는 MinIO credential을 갖지 않고 Spring이 발급한 capability URL만 즉시 사용한다.
- capability URL은 저장하거나 애플리케이션·HTTP client access log에 남기지 않는다.
- consumer는 main queue를 재선언하지 않으며 publish-confirm 뒤에만 원본을 ACK한다.
- 동일 job 재시도와 concurrent stage/activate가 최신 version을 되돌리지 못한다.

## 검증

`tests/test_pgvector_repository.py`와 unit test를 실행한다.
