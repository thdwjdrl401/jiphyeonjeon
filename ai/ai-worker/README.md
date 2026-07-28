# ai-worker

EC2에서 실행하는 배치 AI 작업 프로세스다. lifecycle·관리 probe, Python 소유 RAG 인덱스 저장 경계,
transport-neutral PPTX ingestion 코어, Spring/BGE 외부 adapter와 RabbitMQ consumer를 제공한다. consumer는
기본적으로 꺼져 있으며 명시적으로 활성화할 때만 `ingestion.embed` 작업을 받는다.

```bash
cd ai/ai-worker
uv sync --frozen
AI_WORKER_INSTANCE_ID=worker-1 \
AI_WORKER_DATABASE_URL=postgresql+asyncpg://ai_runtime:secret@localhost:5432/liveclass \
uv run --frozen python -m app.main
```

consumer가 꺼진 scaffold 모드에서는 `/readyz`가 event loop 준비 상태를 뜻한다. consumer를 켜면 RabbitMQ
연결, PostgreSQL 연결, tunnel을 통한 BGE `/readyz`가 모두 정상일 때만 ready다.

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
- `GET /readyz`: consumer 비활성 시 event loop, 활성 시 RabbitMQ·PostgreSQL·BGE 준비 상태

## 폴더별 상세 문서

| 폴더 | 설명 |
|---|---|
| [`app/`](app/README.md) | worker 실행 골격과 ingestion core |
| [`app/domain/`](app/domain/README.md) | index 도메인 모델·오류 |
| [`app/application/`](app/application/README.md) | transport-neutral PPTX indexing use case |
| [`app/ports/`](app/ports/README.md) | asset·embedding·storage port |
| [`app/ingestion/`](app/ingestion/README.md) | 안전한 PPTX parsing·chunking |
| [`app/adapters/`](app/adapters/README.md) | PostgreSQL/pgvector 저장 adapter |
| [`migrations/`](migrations/README.md) | Python 소유 `ai` schema |
| [`tests/`](tests/README.md) | 단위·계약·PostgreSQL 통합 검증 |
| [`scripts/`](scripts/README.md) | 실제 Spring→RabbitMQ→BGE→pgvector E2E probe |

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

이 경계 자체는 RabbitMQ 메시지나 HTTP API가 아니다. 내부 `StagedMaterial`과 Python port는 wire DTO로
재사용하지 않고 별도 adapter mapper가 Spring camelCase envelope를 변환한다. 상세 규약은
[CONTRACT.md](CONTRACT.md)에 있다.

## PPTX runtime adapters

Spring 자료 파이프라인 계약은 [backend aiintegration README](../../backend/src/main/java/com/liveclass/aiintegration/README.md)와
루트 `docs/CONTRACT.md` §3을 기준으로 반영했다.

- `PPTX_EMBED`·`EMBED_DELETE` version 1 wire DTO를 camelCase·extra-forbid로 검증한다.
- `PPTX_EMBED`는 고정 tenant, material version 1, Spring asset compatibility locator와 배포 설정의 BGE
  revision/chunk 전략을 사용해 내부 `StagedMaterial`로 결정적으로 변환한다.
- source adapter는 MinIO 자격증명을 사용하지 않는다. `assetId` 원시 JSON bytes를 Spring 공유 secret으로
  HMAC-SHA256 서명해 주문형 URL을 발급받고, URL을 저장하지 않은 채 50 MiB 상한으로 즉시 streaming GET한다.
- presigned URL의 query signature가 access log에 남지 않도록 `httpx`·`httpcore` INFO 로그를 억제한다.
- remote BGE adapter는 별도 Bearer token을 사용하고 최대 4개씩 순차 호출해 입력 순서를 보존한다.
- callback adapter는 source 발급과 같은 Spring HMAC signer를 재사용하며, 동일 사건의 재시도에 같은
  `eventId`와 raw body를 사용할 수 있다.
- `build_pptx_ingestion_runtime()`은 Spring HTTP client, BGE HTTP client, pgvector engine과 use case를 연결하고
  `aclose()`에서 세 resource를 정리한다. builder 호출만으로 queue를 consume하지 않는다.

## RabbitMQ consumer

`AI_WORKER_MATERIAL_INGESTION_ENABLED=true`일 때만 `app.main`이 consumer를 연결한다. Python 구조로 보면
consumer는 **메시지를 받는 입구**, handler는 **어떤 처리를 할지 정하는 곳**, 기존 ingestion use case는
**PPTX를 실제로 읽고 임베딩·저장하는 곳**이다.

```text
RabbitMQ consumer -> material job handler -> PPTX ingestion use case
                                   |-----> Spring READY/FAILED callback
```

- Spring이 이미 만든 `ingestion.embed` 큐를 passive lookup하므로 큐 속성을 바꾸거나 Java 선언과 충돌하지 않는다.
- 한 번에 한 작업만 받고 성공 callback까지 끝난 뒤 ACK한다.
- 일시 실패는 최대 3회 지수 backoff 후 같은 main queue에 persistent message로 다시 넣는다.
- 영구 실패와 재시도 소진 메시지는 확인 후 ACK하기 전에 `ingestion.embed.dlq`에 먼저 보존한다.
- DB에 BUILDING 결과가 있으면 activate부터 재개하고, SUCCEEDED 결과가 있으면 다운로드·BGE 호출 없이 READY
  callback만 다시 보낸다.
- 종료 시 새 delivery를 멈추고 진행 중인 한 작업을 기본 30초간 기다린다. 제한을 넘기면 원본은 ACK하지 않아
  broker 재전달 대상으로 남는다.

runtime builder를 활성화하려면 아래 설정이 추가로 필요하다. `AI_CALLBACK_SECRET`은 Spring의
`ai.callback-secret`과 같아야 하고 BGE Bearer token과 공유하지 않는다.

| 환경변수 | 기본값/필수 |
|---|---|
| `AI_WORKER_MATERIAL_INGESTION_ENABLED` | `false` |
| `AI_WORKER_RABBITMQ_URL` | consumer 활성화 시 필수 |
| `AI_WORKER_RABBITMQ_RETRY_LIMIT` | `3` |
| `AI_WORKER_RABBITMQ_RETRY_BASE_DELAY_SECONDS` | `5` |
| `AI_WORKER_RABBITMQ_SHUTDOWN_GRACE_SECONDS` | `30` |
| `AI_CALLBACK_SECRET` | 필수, download-url·callback 공용 HMAC secret |
| `AI_WORKER_SPRING_INTERNAL_BASE_URL` | `http://127.0.0.1:8080` |
| `AI_WORKER_BGE_INTERNAL_TOKEN` | 필수, 32자 이상 |
| `AI_WORKER_BGE_READINESS_TIMEOUT_SECONDS` | `2` |
| `AI_WORKER_BGE_RUNTIME_URL` | 로컬 기본 `http://127.0.0.1:8020`; EC2 reverse tunnel 운영은 `http://127.0.0.1:18020` |
| `AI_WORKER_TENANT_ID` | `liveclass` |
| `AI_WORKER_SOURCE_MAX_BYTES` | `52428800` |
| `AI_WORKER_CHUNK_MAX_CHARS` | `1200` |

## EC2 ai-worker ↔ GPU BGE 연결

EC2 host process에서는 아래 두 값으로 reverse tunnel의 loopback endpoint를 사용한다.

```bash
AI_WORKER_BGE_RUNTIME_URL=http://127.0.0.1:18020
AI_WORKER_BGE_INTERNAL_TOKEN=<GPU의-BGE_RUNTIME_INTERNAL_TOKEN과-같은-값>
```

GPU tunnel 실행·EC2 sshd 제한은
[bge-runtime scripts README](../bge-runtime/scripts/README.md), 책임과 대안은
[ADR-0029](../../docs/decisions/canola/0029-gpu-bge-ec2-ai-worker-connectivity.md)를 따른다. 이 설정은 EC2
**host process** 기준이며 container에서는 host network나 tunnel sidecar 결정 없이 localhost를 재사용하지 않는다.

외부 adapter 결정은 [ADR-0018](../../docs/decisions/canola/0018-spring-presigned-pptx-runtime-adapters.md), consumer
수명주기 결정은 [ADR-0019](../../docs/decisions/canola/0019-material-rabbitmq-consumer-lifecycle.md)에 기록했다.
격리 E2E 경계와 실행 절차는 [ADR-0020](../../docs/decisions/canola/0020-local-material-ingestion-e2e-boundary.md),
[E2E runbook](../../docs/decisions/canola/0021-material-ingestion-e2e-runbook.md)에서 관리한다.

### 현재 리뷰·후속 항목

남은 항목은 아래와 같다.

- 공유 계약: embed envelope와 주문형 source 발급은 채택했다. 다만 `EMBED_DELETE`에는 curriculum/version이
  없어 현재 저장소의 scope·tombstone 검증으로 바로 변환할 수 없다. resolver 또는 공유 계약 보강이 필요하다.
- source 저장: 기존 DB column을 파괴적으로 바꾸지 않기 위해 `source_bucket="spring-asset"`,
  `source_object_key=<assetId>` compatibility locator를 사용한다. 실제 MinIO bucket/key가 아니며 column rename은
  data migration 전략과 함께 별도 저장소 MR에서 처리한다.
- 실행 격리: prefetch 1로 동시에 시작하는 parsing thread를 하나로 제한했지만 `asyncio.to_thread` 자체는 강제
  중단할 수 없다. 30초 drain 뒤 취소되어도 Python process 종료 과정은 실행 중인 기본 executor thread를 기다린다.
- 추출 범위: 이미지 OCR, SmartArt, chart와 grouped shape 내부 텍스트는 지원하지 않는다. 필요 시 fixture와
  resource limit을 포함한 별도 기능으로 확장한다.
- 통합 검증: 격리된 Docker 인프라와 host Spring/worker, 실제 CUDA BGE를 연결한 강사 PPTX E2E를 두 번
  통과했다. 두 실행 모두 Spring `READY`, AI `ACTIVE`, chunk/embedding 1개, 1024차원을 확인했다.
- 활성화 gate: 검증된 `PPTX_EMBED` 경로는 필요한 서비스와 secret이 준비된 환경에서 opt-in으로 켤 수 있다.
  기본값은 계속 false이며, 운영 Compose network와 `EMBED_DELETE` resolver를 보강하기 전 전역 활성화하지 않는다.

## Verification

현재 consumer 기준 전체 결과는 `248 passed, 0 skipped`다. 경고 1건은 FastAPI TestClient가
Starlette의 기존 httpx 호환 경로를 불러올 때 발생하는 deprecation warning이며 이번 변경에서 추가한 실패나
skip은 아니다.

2026-07-27 실제 E2E의 최종 확인 결과는 material `dd78649c-8b8c-4603-ab9c-0f5f1b1152a8`,
`state=ACTIVE`, `chunkCount=1`, `embeddingCount=1`, `dimensions=1024`다. Spring AI 연동·자료 계약 테스트는
`BUILD SUCCESSFUL`, BGE는 `64 passed`, worker image는 non-root `liveclass` 사용자로 `healthy/ready`를 확인했다.

기본 테스트는 실행 중인 개발용 PostgreSQL 서버 안에 고유한 `liveclass_ai_*_test` DB와
`ai_app_*_test NOLOGIN NOINHERIT` role을 만들고 제거하므로 pgvector 통합 테스트 16개를 항상 포함한다.
Java가 사용하는 `liveclass` DB와 기존 cluster role은 수정하지 않는다.
PostgreSQL이 꺼져 있거나 test DB를 만들 권한이 없으면 skip하지 않고 테스트를 실패시킨다.

```bash
uv lock --check
uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check app tests migrations scripts
uv run --frozen ruff format --check app tests migrations scripts
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
