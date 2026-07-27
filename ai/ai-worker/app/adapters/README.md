# `ai-worker/app/adapters`

현재 구현된 PostgreSQL/pgvector index storage adapter를 둔다.

## 역할

- `ai` schema에 shadow material version과 chunk/embedding을 transaction으로 저장한다.
- advisory lock, idempotency, version 역행 방지와 단일 ACTIVE 전환을 강제한다.
- vector를 unit norm으로 저장하고 material scope 변경을 거부한다.

## 구조와 흐름

```text
IndexStorage -> PgvectorIndexRepository -> PostgreSQL ai schema
```

## 파일 구성

`pgvector_index.py`가 저장 구현이며 `__init__.py`가 package 경계다.

## 경계와 불변식

- `SET LOCAL ROLE ai_app`과 Python 소유 schema만 사용한다.
- RabbitMQ, MinIO, remote BGE, Spring callback adapter는 아직 없다.
- 동일 job 재시도와 concurrent stage/activate가 최신 version을 되돌리지 못한다.

## 검증

`tests/test_pgvector_repository.py`와 unit test를 실행한다.
