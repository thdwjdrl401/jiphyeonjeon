# `ai-worker/app/adapters`

PostgreSQL/pgvector와 RabbitMQ, Spring material capability, remote BGE adapter, GMS 핵심 용어
adapter를 둔다.

## 역할

- `ai` schema에 shadow material version과 chunk/embedding을 transaction으로 저장한다.
- advisory lock, idempotency, version 역행 방지와 단일 ACTIVE 전환을 강제한다.
- `resolve_active_scope`로 materialId만으로 curriculum_id·현재 버전을 self-lookup하고, `delete_job`으로
  자료를 tombstone과 함께 삭제한다(ADR-0006).
- vector를 unit norm으로 저장하고 material scope 변경을 거부한다.
- Spring HMAC으로 단명 다운로드 URL과 완료 callback을 주고받는다.
- BGE-M3 HTTP 입력 순서를 보존하고 RabbitMQ ACK/retry/DLQ를 관리한다.
- GMS(OpenAI 호환) structured output으로 PPTX 텍스트에서 핵심 용어+정의를 추출한다(선택 기능).
- 추출된 핵심 용어와 결과 상태·개수·절단·실패 코드를 자료 버전에 종속해 원자적으로 저장한다
  (ADR-0005, ADR-0010).

## 구조와 흐름

```text
RabbitMaterialConsumer -> MaterialJobHandler
SpringPresignedPptxAssetStore -> Spring/MinIO
RemoteBgeM3EmbeddingModel -> bge-runtime
GmsKeyTermExtractor -> GMS(OpenAI 호환 게이트웨이)
IndexStorage -> PgvectorIndexRepository -> PostgreSQL ai schema
KeyTermStorage -> PgvectorKeyTermRepository -> PostgreSQL ai schema
```

## 파일 구성

`pgvector_index.py`, `rabbitmq_material_consumer.py`, `spring_material_*`,
`remote_bge_embedding.py`, `gms_key_term_extractor.py`, `pgvector_key_term_storage.py`가 외부
경계를 구현한다.

## 경계와 불변식

- `SET LOCAL ROLE ai_app`과 Python 소유 schema만 사용한다.
- worker는 MinIO credential을 갖지 않고 Spring이 발급한 capability URL만 즉시 사용한다.
- capability URL은 저장하거나 애플리케이션·HTTP client access log에 남기지 않는다.
- consumer는 main queue를 재선언하지 않으며 publish-confirm 뒤에만 원본을 ACK한다.
- 동일 job 재시도와 concurrent stage/activate가 최신 version을 되돌리지 못한다.
- GMS 요청 실패·응답 계약 위반은 `KeyTermExtractionError`로만 표면화하고, 원문·API key를 로그에
  남기지 않는다. 호출자(application 계층)가 실패를 삼키고 인덱싱을 계속할지 결정한다.
- `PgvectorKeyTermRepository`도 `SET LOCAL ROLE ai_app`만 쓰며, 저장 실패는 예외로만 표면화하고
  삼킬지 여부는 호출자(application 계층)가 결정한다 — repository 스스로는 재시도·로깅을 하지 않는다.

## 검증

`tests/test_pgvector_repository.py`(실 Postgres, `resolve_active_scope`/`delete_job` 포함),
`tests/test_gms_key_term_extractor.py`, `tests/test_pgvector_key_term_storage_unit.py`와 unit
test를 실행한다.
