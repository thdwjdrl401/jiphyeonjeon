# ai-worker

## 1. 이 서비스가 하는 일

`ai-worker`는 EC2에서 실행되는 비동기 자료 처리 프로세스다. Spring이 RabbitMQ에 넣은 PPTX 작업을 받아
원본을 내려받고, bge-runtime에서 embedding을 생성해 PostgreSQL `ai` schema에 저장한 뒤 결과를 Spring에 알린다.

작업용 HTTP endpoint는 없다. FastAPI는 관리용 health/readiness endpoint만 제공한다.

## 2. 누가 어떻게 호출하는가

| 호출자 | 대상 | 통신 | 용도 | 상태 |
|---|---|---|---|---|
| Spring·ai-worker | RabbitMQ `ingestion.embed` | durable queue | 작업 전달·일시 실패 retry 재발행 | 구현됨, 기본 비활성 |
| 운영 환경 | `GET /healthz`, `GET /readyz` | HTTP | 프로세스·의존성 준비 확인 | 구현됨 |
| ai-worker | Spring `POST /api/internal/ai/materials/download-url` | HTTP, HMAC | PPTX 임시 다운로드 URL 발급 | 구현됨 |
| ai-worker | 발급된 presigned URL | HTTP GET | PPTX 원본 다운로드 | 구현됨 |
| ai-worker | bge-runtime `GET /readyz`, `POST /internal/v1/embeddings` | HTTP, Bearer | BGE 준비 확인·embedding 생성 | 구현됨 |
| ai-worker | GMS(OpenAI 호환) `POST /chat/completions` | HTTP, Bearer, structured output | PPTX 전체 텍스트에서 핵심 용어+정의 추출 | 구현됨, 기본 비활성 |
| ai-worker | PostgreSQL `ai` schema | SQL/pgvector | 작업·chunk·embedding 저장 및 활성화 | 구현됨 |
| ai-worker | Spring `POST /api/internal/ai/callbacks` | HTTP, HMAC | READY·FAILED 및 (있으면) 핵심 용어 결과 전달 | 구현됨 |
| ai-worker | RabbitMQ `ingestion.embed.dlq` | durable queue | 영구 실패·재시도 소진 작업 보존 | 구현됨 |

consumer는 `AI_WORKER_MATERIAL_INGESTION_ENABLED=true`일 때만 연결된다. `EMBED_DELETE`는
`materialId`만으로 `ai.material_version`을 self-lookup해 `curriculum_id`와 현재 버전을 알아낸 뒤
삭제한다([ADR-0006](../../docs/decisions/jinwoo/0006-pptx-material-delete-resolution.md)) — Spring
계약에 필드를 추가하지 않는다. 지울 게 이미 없으면(중복 요청 등) 성공으로 처리하는 멱등 동작이다.
전체 주소·인증·구현 상태는 [`docs/ai/CONTRACT.md`](../../docs/ai/CONTRACT.md)를 따른다.

핵심 용어 추출은 v2 작업의 `policy.extractKeyTerms=true` 또는 v1 작업의
`AI_WORKER_KEY_TERM_EXTRACTION_ENABLED=true`일 때 임베딩과 동시에 실행된다. 추출 실패는 자료 처리
전체를 실패시키지 않지만 `keyTermResult=FAILED`로 명시해 정상 0건(`EMPTY`)과 구분한다.

추출된 용어는 ai-worker가 소유하는 `ai.material_key_term`에 자료 버전 단위로 저장하고, 같은
material version에 상태·개수·절단 여부·실패 코드를 함께 영속화한다. callback에는 원문 목록 대신
`outputs.keyTermResult`를 보내 Spring의 `keyTermStatus` projection을 갱신한다. callback 유실이나
worker 재시작 뒤에도 DB 결과로 같은 terminal callback을 재구성한다. Java의 기존 glossary 조회는
활성 material version의 `ai.material_key_term`을 읽는다. 설계 배경은
[ADR-0003](../../docs/decisions/jinwoo/0003-pptx-key-term-extraction-approach.md),
[ADR-0004](../../docs/decisions/jinwoo/0004-key-term-callback-delivery-timing.md),
[ADR-0005](../../docs/decisions/jinwoo/0005-key-term-storage-schema.md)와
[ADR-0010](../../docs/decisions/choinhoo/0010-recorded-lesson-pptx-embedding-and-key-term-extraction.md)을 따른다.

## 3. 통신 예시

Spring이 `ingestion.embed`에 보내는 대표 작업은 다음과 같다.

```json
{
  "taskType": "PPTX_EMBED",
  "materialId": "11111111-1111-4111-8111-111111111111",
  "assetId": "22222222-2222-4222-8222-222222222222",
  "lessonId": "33333333-3333-4333-8333-333333333333",
  "curriculumId": "44444444-4444-4444-8444-444444444444",
  "fileName": "강의자료.pptx",
  "policy": {"embedModel": "bge-m3", "extractKeyTerms": true},
  "contractVersion": 2
}
```

저장 완료 후 worker는 JSON 원문을 HMAC-SHA256으로 서명해 Spring에 결과를 보낸다. v2 callback은
임베딩 결과와 용어 결과 상태를 독립적으로 전달한다.

```http
POST /api/internal/ai/callbacks HTTP/1.1
Content-Type: application/json
X-Signature: <base64-hmac-signature>

{
  "eventId": "c43584d7-50ef-5ebe-8087-717248182bf7",
  "eventType": "MATERIAL_EMBEDDED",
  "jobId": "PPTX_EMBED:11111111-1111-4111-8111-111111111111",
  "materialId": "11111111-1111-4111-8111-111111111111",
  "lessonId": "33333333-3333-4333-8333-333333333333",
  "status": "READY",
  "outputs": {
    "materialVersionId": 321,
    "chunkCount": 42,
    "keyTermResult": {"status": "READY", "count": 18, "truncated": false}
  }
}
```

전체 message, callback, 상태코드, ACK·retry·DLQ 규칙은 [`CONTRACT.md`](CONTRACT.md)에서 확인한다.

## 4. 처리 흐름

```text
Spring
  → RabbitMQ ingestion.embed
  → ai-worker
  → Spring download-url → presigned PPTX GET
  → bge-runtime embedding
  → PostgreSQL ai schema 활성화
  → Spring READY/FAILED callback
  → RabbitMQ ACK
```

한 번에 한 작업만 처리한다. 성공 callback까지 끝나야 원본 message를 ACK하며, 일시 실패는 재시도하고
영구 실패 또는 재시도 소진은 DLQ에 먼저 보존한다.

## 5. 실행과 설정

```bash
cd ai/ai-worker
uv sync --frozen
AI_WORKER_INSTANCE_ID=worker-1 \
AI_WORKER_DATABASE_URL=postgresql+asyncpg://ai_runtime:secret@127.0.0.1:5432/liveclass \
uv run --frozen python -m app.main
```

| 환경변수 | 필요 조건 | 용도 |
|---|---|---|
| `AI_WORKER_INSTANCE_ID`, `AI_WORKER_DATABASE_URL` | 실행 필수 | worker 식별자와 PostgreSQL 연결 |
| `AI_WORKER_MATERIAL_INGESTION_ENABLED` | 선택, 기본 `false` | 자료 consumer 활성화 |
| `AI_WORKER_RABBITMQ_URL` | consumer 활성화 시 필수 | RabbitMQ 연결 |
| `AI_CALLBACK_SECRET` 또는 `AI_WORKER_SPRING_HMAC_SECRET` | consumer 활성화 시 필수 | Spring download-url·callback HMAC |
| `AI_WORKER_BGE_INTERNAL_TOKEN` | consumer 활성화 시 필수 | bge-runtime Bearer token |
| `AI_WORKER_SPRING_INTERNAL_BASE_URL` | 선택 | 기본 `http://127.0.0.1:8080` |
| `AI_WORKER_BGE_RUNTIME_URL` | 선택, 기본 `http://127.0.0.1:8020` | 로컬 `:8020`, EC2 host `:18020`, 운영 container `liveclass-bge-runtime-cpu:8020` |
| `AI_WORKER_KEY_TERM_EXTRACTION_ENABLED` | 선택, 기본 `false` | PPTX 핵심 용어 추출 활성화 |
| `AI_WORKER_ANNOTATION_INGESTION_ENABLED` | 선택, 기본 `false` | 강조 판서 색인 활성화. Spring이 보낸 텍스트를 임베딩·저장만 한다 |
| `AI_WORKER_GMS_API_KEY` | 핵심 용어 추출 활성화 시 필수 | GMS(OpenAI 호환) API key. 강조 판서 색인은 모델을 부르지 않아 필요 없다 |
| `AI_WORKER_GMS_MODEL` | 선택 | 기본 `gpt-4.1`. 핵심 용어 추출용 텍스트 모델 |
| `AI_WORKER_ANNOTATION_IMAGE_MAX_BYTES` | 선택 | 기본 4 MiB. 현재 미사용 — 파킹된 이미지 경로용(CONTRACT §11.2) |

운영에서는 root [`.env.ai-prod.example`](../../.env.ai-prod.example)의 `AI_CALLBACK_SECRET`을
container의 `AI_WORKER_SPRING_HMAC_SECRET`으로, `BGE_RUNTIME_INTERNAL_TOKEN`을
`AI_WORKER_BGE_INTERNAL_TOKEN`으로 매핑한다. `AI_INTERNAL_SECRET`은 ai-api용이며 worker와
bge-runtime에는 주입하지 않는다.

| 실행 형태 | `AI_WORKER_BGE_RUNTIME_URL` |
|---|---|
| 로컬 runtime | `http://127.0.0.1:8020` |
| EC2 host process | `http://127.0.0.1:18020` |
| EC2 운영 container | `http://liveclass-bge-runtime-cpu:8020`(compose 기본값, `BGE_RUNTIME_URL`로 덮어씀) |

기본 관리 주소는 `127.0.0.1:8011`이다. 최초 DB 준비에는 psycopg migration DSN이 필요하다.

```bash
AI_WORKER_MIGRATION_DATABASE_URL=postgresql+psycopg://migration_admin:secret@127.0.0.1:5432/liveclass \
uv run --frozen alembic upgrade head
```

DB role과 권한 조건은 [migration 문서](migrations/README.md)를 따른다.

## 6. 상태 확인

| endpoint | consumer 비활성 | consumer 활성 |
|---|---|---|
| `GET /healthz` | 프로세스가 응답함 | 프로세스가 응답함 |
| `GET /readyz` | event loop 준비 | RabbitMQ consumer 등록 + PostgreSQL 연결 + bge-runtime 준비 |

관리 port는 외부 ingress에 노출하지 않는다. FastAPI 자동 생성 `/docs`, `/redoc`, `/openapi.json`은
개발 편의 기능이며 작업 계약이 아니다.

## 7. 관련 문서

- [AI 전체 통신 계약](../../docs/ai/CONTRACT.md)
- [ai-worker 상세 계약](CONTRACT.md)
- [애플리케이션 구조](app/README.md)
- [자료 처리 use case](app/application/README.md)
- [외부 adapter](app/adapters/README.md)
- [DB migration](migrations/README.md)
- [Spring AI 연동](../../backend/src/main/java/com/liveclass/aiintegration/README.md)
- [bge-runtime 실행과 운영 배포](../bge-runtime/README.md)
- [EC2 AI 운영 compose](../../docker-compose.ai-prod.yml)
- [EC2 AI 운영 환경변수](../../.env.ai-prod.example)
- [PPTX 핵심 용어 추출 방식 ADR](../../docs/decisions/jinwoo/0003-pptx-key-term-extraction-approach.md)
- [핵심 용어 콜백 전달 타이밍 ADR](../../docs/decisions/jinwoo/0004-key-term-callback-delivery-timing.md)
- [핵심 용어 저장 스키마 ADR](../../docs/decisions/jinwoo/0005-key-term-storage-schema.md)
- [PPTX 자료 삭제 스코프 해석 ADR](../../docs/decisions/jinwoo/0006-pptx-material-delete-resolution.md)
