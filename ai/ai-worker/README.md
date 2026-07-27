# ai-worker

EC2에서 실행하는 배치 AI 작업 프로세스다. 현재는 lifecycle·관리 probe와 Python 소유 RAG 인덱스
저장 경계를 제공한다. RabbitMQ/PPTX ingestion과 Spring 연동은 후속 MR 범위다.

```bash
cd ai/ai-worker
uv sync --frozen
AI_WORKER_INSTANCE_ID=worker-1 \
AI_WORKER_DATABASE_URL=postgresql+asyncpg://ai_runtime:secret@localhost:5432/liveclass \
uv run --frozen python -m app.main
```

현재 `/readyz`는 DB 연결 상태를 의미하지 않는다. 실제 consumer wiring에서 DB 연결과 consumer 준비 상태를
readiness에 포함한다.

## RAG index migration

마이그레이션 전에 DBA가 최소 권한 group role을 한 번 만든다. migration은 기존 role이 `NOLOGIN`,
`NOINHERIT`, non-superuser이고 다른 role의 member가 아니며 `ai` schema owner도 아닌지 fail-closed로 검사한다.
사전 생성 schema의 `PUBLIC` 등 간접 ACL로 CREATE가 남아 있어도 migration은 중단한다.

```sql
CREATE ROLE ai_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
```

마이그레이션 계정에는 extension·schema·table을 만드는 DDL 권한이 필요하다. runtime asyncpg 옵션을 psycopg에
잘못 전달하지 않도록 migration DSN은 별도로 둔다.

```bash
AI_WORKER_MIGRATION_DATABASE_URL=postgresql+psycopg://migration_admin:secret@localhost:5432/liveclass \
uv run --frozen alembic upgrade head
```

런타임 DB login에는 운영자가 `GRANT ai_app TO <runtime_login>`을 별도로 적용한다. 마이그레이션은 login
이름을 추측하거나 `core` schema ACL을 수정하지 않는다. `ai_app`은 이 migration이 명시한 `ai` 저장
테이블 DML만 받고 schema DDL 권한은 받지 않는다. 저장 규약 정본은 [CONTRACT.md](CONTRACT.md)다.

관리 HTTP는 업무 API가 아니며 기본 `127.0.0.1:8011`에만 열린다.

- `GET /healthz`: 프로세스 생존
- `GET /readyz`: worker event loop 준비 상태

컨테이너 probe 때문에 `AI_WORKER_MANAGEMENT_HOST=0.0.0.0`을 사용하더라도 외부 ingress에는 포트를
노출하지 않는다.

## Verification

기본 테스트의 PostgreSQL 항목은 DB URL이 없으면 skip된다. skip 결과를 통합 테스트 통과로 세지 않는다.

```bash
uv lock --check
uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check app tests migrations
uv run --frozen ruff format --check app tests migrations
```

실제 pgvector 통합 테스트는 이름이 `_test`로 끝나며 `core`·`ai` schema와 활성 Alembic revision이 없는
폐기 가능한 전용 DB에서만 실행한다. 이 테스트는 downgrade와 fixture schema 삭제를 수행한다.

```bash
AI_WORKER_TEST_DATABASE_URL=postgresql+asyncpg://admin:secret@localhost/liveclass_ai_test \
AI_WORKER_TEST_MIGRATION_DATABASE_URL=postgresql+psycopg://admin:secret@localhost/liveclass_ai_test \
AI_WORKER_ALLOW_DESTRUCTIVE_TEST_DB=1 \
uv run --frozen pytest -q -p no:cacheprovider tests/test_pgvector_repository.py
```
