# PPTX material ingestion 로컬 E2E runbook

강사 API 업로드가 실제로 `Spring outbox → RabbitMQ → ai-worker → BGE-M3 → pgvector → Spring callback`을
통과하는지 확인하는 opt-in 절차다. RAG 질문·검색 경로는 다루지 않는다.

## 1. 인프라

```powershell
Copy-Item .env.material-ingestion.example .env.material-ingestion
docker compose -f docker-compose.material-ingestion.yml --env-file .env.material-ingestion up -d
docker compose -f docker-compose.material-ingestion.yml ps
```

최초 PostgreSQL volume은 `infra/postgres/init/02-ai-runtime-role.sql`로 `ai_app` group role을 만든다.
그 다음 Python 소유 schema를 migration한다.

```powershell
cd ai/ai-worker
$env:AI_WORKER_MIGRATION_DATABASE_URL='postgresql+psycopg://liveclass:liveclass@127.0.0.1:15432/liveclass'
uv run --frozen alembic upgrade head
```

## 2. BGE-M3

로컬 CUDA cache가 있으면 host 실행이 가장 빠르다.

```powershell
cd ai/bge-runtime
$env:BGE_RUNTIME_INTERNAL_TOKEN='local-bge-token-change-me-00000001'
$env:BGE_RUNTIME_PORT='18020'
uv run --frozen --extra cuda python -m app.main
```

NVIDIA Container Toolkit이 준비된 환경은 격리 스택의 `gpu` profile을 대신 사용할 수 있다.

## 3. Spring과 worker

Spring은 명시적으로 임베딩 스위치를 켠다. master의 Spring은 기동 중 RabbitMQ 연결을
강제하지 않으므로, 새 RabbitMQ volume에서 worker를 먼저 시작하려면 `ingestion.embed` durable queue를
배포 인프라로 미리 생성해야 한다. 이 runbook은 큐가 이미 존재하는 환경을 전제로 한다.

```powershell
cd backend
$env:MATERIAL_EMBEDDING_ENABLED='true'
$env:SPRING_RABBITMQ_HOST='127.0.0.1'
$env:SPRING_RABBITMQ_PORT='15673'
$env:SPRING_RABBITMQ_USERNAME='liveclass'
$env:SPRING_RABBITMQ_PASSWORD='liveclass'
$env:SPRING_DATASOURCE_URL='jdbc:postgresql://127.0.0.1:15432/liveclass'
$env:SPRING_DATASOURCE_USERNAME='liveclass'
$env:SPRING_DATASOURCE_PASSWORD='liveclass'
$env:SPRING_DATA_REDIS_HOST='127.0.0.1'
$env:SPRING_DATA_REDIS_PORT='16379'
$env:ASSET_STORAGE_ENDPOINT='http://127.0.0.1:19000'
$env:ASSET_STORAGE_ACCESS_KEY='minioadmin'
$env:ASSET_STORAGE_SECRET_KEY='minioadmin'
$env:SERVER_PORT='18080'
$env:AI_CALLBACK_SECRET='dev-ai-callback-secret'
$env:OUTBOX_RELAY_INITIAL_DELAY_MS='500'
$env:OUTBOX_RELAY_FIXED_DELAY_MS='500'
.\gradlew.bat bootRun
```

다른 터미널에서 worker consumer를 켠다.

```powershell
cd ai/ai-worker
$env:AI_WORKER_INSTANCE_ID='material-e2e-worker'
$env:AI_WORKER_MANAGEMENT_PORT='18011'
$env:AI_WORKER_DATABASE_URL='postgresql+asyncpg://liveclass:liveclass@127.0.0.1:15432/liveclass'
$env:AI_WORKER_MATERIAL_INGESTION_ENABLED='true'
$env:AI_WORKER_RABBITMQ_URL='amqp://liveclass:liveclass@127.0.0.1:15673/'
$env:AI_CALLBACK_SECRET='dev-ai-callback-secret'
$env:AI_WORKER_BGE_INTERNAL_TOKEN='local-bge-token-change-me-00000001'
$env:AI_WORKER_SPRING_INTERNAL_BASE_URL='http://127.0.0.1:18080'
$env:AI_WORKER_BGE_RUNTIME_URL='http://127.0.0.1:18020'
uv run --frozen python -m app.main
```

## 4. 실제 강사 업로드 검증

```powershell
cd ai/ai-worker
uv run --frozen python scripts/e2e_material_ingestion.py `
  --base-url http://127.0.0.1:18080 `
  --database-url postgresql://liveclass:liveclass@127.0.0.1:15432/liveclass
```

성공 출력은 `status=ok`, `state=ACTIVE`, `chunkCount>=1`, 같은 `embeddingCount`, `dimensions=1024`를
포함한다. 스크립트는 실제 로컬 사용자·커리큘럼·레슨·자료를 남긴다. 현재 삭제 consumer는 별도 하드닝
범위라 probe가 자동 삭제하지 않는다.

## 범위와 안전장치

- `MATERIAL_EMBEDDING_ENABLED` 기본값은 계속 false다. 이 절차에서만 명시적으로 켠다.
- 실제 secret을 example이나 Git에 넣지 않는다.
- `ai/ai-api/**`, RAG retrieval/query/RRF/answer 코드는 이 흐름에 포함되지 않는다.
- 완료 증거는 worker 단위 테스트와 실제 E2E를 구분해 기록한다.

## 2026-07-27 실행 증거

- 같은 격리 스택에서 실제 강사 업로드를 두 번 실행해 모두 `READY` callback을 받았다.
- 이 실행 당시에는 Spring 기동 중 큐를 선언하는 후보 코드가 있었다. Java 변경을 master로
  되돌린 후에는 큐 사전 생성이 배포 전제이며, clean broker bootstrap E2E는 다시 확인해야 한다.
- 최종 material `dd78649c-8b8c-4603-ab9c-0f5f1b1152a8`은 AI DB에서 `ACTIVE`, chunk 1개,
  embedding 1개, 1024차원으로 확인했다.
- worker 로그에서 presigned URL query가 노출되는 문제를 첫 실행에서 발견해 `httpx`·`httpcore` INFO 로그를
  억제했고, 두 번째 실행에는 `X-Amz-*` query가 남지 않았다.
- 검증 후 host 애플리케이션은 종료하고 Compose 서비스는 `docker compose ... stop`으로 중지했다. named volume은
  재현 확인을 위해 보존했다.
