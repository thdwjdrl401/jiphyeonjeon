# ai-worker

EC2에서 실행하는 배치 AI 작업 프로세스다. 현재는 lifecycle·관리 probe, Python 소유 RAG 인덱스 저장 경계와
transport-neutral PPTX ingestion 코어를 제공한다. RabbitMQ consumer, 객체 저장소 runtime adapter와 Spring
연동은 후속 MR 범위다.

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

## PPTX ingestion core

현재 구현은 외부 transport와 분리된 Python 내부 use case다. adapter가 전달한 PPTX bytes를 메모리에서
검증·파싱하고, 슬라이드 경계를 유지한 deterministic chunk를 만든 뒤 embedding 응답을 검증한다. 모든 chunk를
저장소에 stage한 경우에만 같은 material identity로 activate한다. 파싱, chunking, embedding 또는 stage 중
하나라도 실패하면 activate하지 않는다.

- ZIP entry를 디스크에 풀지 않으며 경로 탈출, 이름 충돌, symlink, 암호화 entry와 package/resource limit 위반을
  거부한다.
- 텍스트, 표, 발표자 노트를 슬라이드 순서로 읽는다. 지원되는 텍스트가 없는 자료는 성공으로 가장하지 않고
  typed ingestion error로 종료한다.
- chunk는 서로 다른 슬라이드를 합치지 않는다. NFC·공백 정규화, 고정 순서, page를 포함한 content hash와
  versioned chunk strategy로 같은 입력의 결과를 재현한다.
- embedding model 이름·고정 revision·차원과 응답 개수·finite non-zero vector 조건을 저장 전에 검증한다.
  vector 순서는 adapter가 입력 순서를 보존하는 positional port 계약으로 고정한다.
- 동기식 OOXML 파싱과 chunking은 event loop를 막지 않도록 `asyncio.to_thread`로 offload한다.

이 경계는 RabbitMQ 메시지나 HTTP API가 아니다. 내부 `StagedMaterial`과 Python port는 wire DTO로 재사용하거나
Java가 채택한 계약으로 해석하지 않는다. 현재 `app.main`도 ingestion job을 consume하지 않는다. 상세 규약은
[CONTRACT.md](CONTRACT.md)에 있다.

### 후속 리뷰 항목

다음 runtime·연동 MR에서는 아래 항목을 닫기 전 완료로 선언하지 않는다.

- 공유 계약: `curriculumId`는 후보일 뿐 Java와 함께 채택한 wire field가 아니다. source version,
  idempotency key, delete scope와 source acquisition 규약도 아직 합의되지 않았다.
- 삭제 경계: material index 삭제와 원본 객체 삭제는 이 코어에 포함하지 않는다. immutable/versioned asset의
  소유권을 합의한 뒤 별도 use case로 추가한다.
- 객체 저장소: MinIO adapter를 추가할 때 stat 기반 크기 제한, MIME/content-type 확인과 download 전 guard를
  적용한다. 이번 MR에는 MinIO 연결이 없다.
- embedding runtime: remote BGE adapter의 최대 batch 크기 4, 입력-출력 순서 보존, 인증과 timeout을
  별도 계약·테스트로 고정한다.
- 메시지 처리: RabbitMQ ACK 시점, retry/backoff, DLQ, callback/outbox와 성공 결과 재조회 흐름을 결정한다.
- 실행 격리: `asyncio.to_thread` task를 취소해도 이미 실행 중인 worker thread는 멈추지 않는다. bounded executor
  또는 process isolation, 동시 job 제한과 shutdown drain을 runtime에서 설계한다.
- 재시도 일관성: 저장 fingerprint에는 embedding 값도 포함된다. GPU 비결정성 때문에 같은 입력의 재시도 결과가
  달라질 수 있으므로 completed-job short circuit 또는 durable result/outbox 없이 무조건 재임베딩하지 않는다.
- 추출 범위: 이미지 OCR, SmartArt, chart와 grouped shape 내부 텍스트는 지원하지 않는다. 필요 시 fixture와
  resource limit을 포함한 별도 기능으로 확장한다.
- 통합 검증: 실제 MinIO, RabbitMQ, remote BGE를 연결한 E2E는 이번 MR에서 실행하지 않았다. 각 adapter를
  도입하는 MR에서 실패·재전달 경로까지 검증한다.

## Verification

기본 테스트는 실행 중인 개발용 PostgreSQL 서버 안에 고유한 `liveclass_ai_*_test` DB와
`ai_app_*_test NOLOGIN NOINHERIT` role을 만들고 제거하므로 pgvector 통합 테스트 16개를 항상 포함한다.
Java가 사용하는 `liveclass` DB와 기존 cluster role은 수정하지 않는다.
PostgreSQL이 꺼져 있거나 test DB를 만들 권한이 없으면 skip하지 않고 테스트를 실패시킨다.

```bash
uv lock --check
uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check app tests migrations
uv run --frozen ruff format --check app tests migrations
```

기본 `docker-compose.yml`의 PostgreSQL 계정에서는 별도 환경변수가 필요 없다.

```bash
docker compose up -d postgres
cd ai/ai-worker
uv run --frozen pytest -q -p no:cacheprovider tests/test_pgvector_repository.py
```

Compose의 PostgreSQL 계정이나 포트를 바꾼 환경은 관리자 DB URL 하나만 설정한다.

```bash
AI_WORKER_TEST_ADMIN_URL=postgresql+psycopg://admin:secret@localhost:5432/postgres \
uv run --frozen pytest -q -p no:cacheprovider
```

외부에서 미리 만든 test DB를 사용하는 CI는 기존 `AI_WORKER_TEST_DATABASE_URL`,
`AI_WORKER_TEST_MIGRATION_DATABASE_URL`, `AI_WORKER_ALLOW_DESTRUCTIVE_TEST_DB=1` 조합을 계속 사용할 수 있다.
