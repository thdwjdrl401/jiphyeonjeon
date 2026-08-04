# ai-worker RAG index storage, PPTX ingestion and Spring adapter contract

이 문서는 Python `ai-worker` 내부의 repository↔PostgreSQL 저장 규약, transport-neutral PPTX ingestion
코어와 Spring 연동 adapter가 지켜야 할 소비자 규약이다. Spring 공유 계약의 정본은 루트
`docs/CONTRACT.md`와 ADR-0036이며, 이 문서는 그 계약을 Python port·adapter와 테스트에 적용하는 방법만
구체화한다. 공유 wire field를 변경할 때는 이 문서만 단독으로 바꾸지 않는다.

## 1. 식별자와 명명

- 외부 도메인 식별자는 `curriculum_id`, `lesson_id`, `material_id`이며 모두 PostgreSQL `uuid`다.
- 원본 실험 브랜치의 `course_id`와 bigint 식별자는 사용하지 않는다.
- 저장 identity는 `(tenant_id, material_id)`다. 한 identity의 `curriculum_id`와 `lesson_id`는 불변이다.
- `material_version`은 1 이상의 단조 증가 정수다.
- 테이블 내부 PK는 Python 저장소 전용 `bigint identity`이며 외부 계약에 노출하지 않는다.

## 2. 테이블 소유 경계

Alembic revision `0001_rag_index_storage`가 아래 테이블을 소유한다.

- `ai.job_run`: index/delete 실행과 성공한 delete tombstone
- `ai.model_run`: embedding 모델명·고정 revision·차원 기록
- `ai.material_version`: 자료별 shadow version과 상태
- `ai.document_chunk`: 슬라이드 chunk와 FTS vector
- `ai.chunk_embedding`: 정규화된 `vector(1024)`
- `ai.material_key_term`: 자료 버전별 추출 용어와 정의 (revision `0002_material_key_terms`)
- `ai.annotation_snapshot`: 강조 판서 스냅샷의 해석 텍스트·임베딩·타임라인 앵커 (revision
  `0003_annotation_snapshot`)

`material_key_term`은 `(material_version_id, term)`을 기본키로 사용한다. Java는
`ai.material_version.state = 'ACTIVE'`인 자료 버전과 조인해 최신 자료의 용어만 읽는다(읽기 API는
아직 없다). 재임베딩으로 기존 버전이 교체되거나 자료 버전이 삭제되면 FK cascade로 해당 용어도
함께 정리된다.

ai-worker는 `IndexPptxMaterial.execute()`가 stage/activate를 마친 뒤 추출된 용어를 이 테이블에
upsert한다(`(material_version_id, term)` 충돌 시 `definition`만 갱신). 이 저장은 best-effort다 —
실패해도 로그만 남기고 Spring 콜백 전송이나 job 자체를 막지 않는다([ADR-0005](../../docs/decisions/jinwoo/0005-key-term-storage-schema.md)).

`annotation_snapshot`은 자료 색인 테이블과 FK로 연결되지 않는 독립 색인이다. 스냅샷 1건이 곧 색인
단위이므로 chunk/embedding 분리 없이 `text`·`embedding`을 같은 행에 둔다. `snapshot_id`가 멱등 키이고
`search_vector`는 `document_chunk`와 같은 생성 컬럼이라 `text`와 어긋날 수 없다. 삭제는 행 제거가 아니라
`state='DELETED'` 전환이다([ADR-0043](../../docs/decisions/canola/0043-annotation-timeline-evidence-mvp.md)).

`ai` schema 자체와 `vector` extension은 공유 인프라가 미리 만들 수 있다. 따라서 downgrade는 위 테이블만
역순으로 제거하고 schema, extension, role은 제거하지 않는다.

## 3. embedding 규약

- 모델명은 `BAAI/bge-m3`다.
- 모델 revision은 이동하는 branch/tag가 아닌 7~64자리 소문자 hexadecimal commit revision이다.
- 입력은 정확히 1024개의 finite 값으로 이루어진 non-zero vector다.
- repository는 저장 직전에 L2 unit norm으로 정규화한다.
- DB는 `vector(1024)`, `normalized = true`, cosine HNSW opclass를 강제한다.

## 4. version 상태와 원자성

상태 전이는 다음과 같다.

```text
BUILDING -> ACTIVE -> RETIRED
    `----> FAILED
```

- `stage`는 job/model/version/chunk/embedding 전체를 한 transaction에 기록한다. 한 chunk라도 실패하면 전부
  rollback한다.
- stage 입력 chunk를 canonical order로 hash한 `input_fingerprint`를 version에 보관한다. 같은 job/version의
  재호출이라도 chunk index/page/text/content hash/정규화 embedding이 달라지면 멱등 성공으로 처리하지 않는다.
- `activate`는 `(tenant_id, material_id)` advisory transaction lock을 잡고 기존 ACTIVE를 RETIRED로 바꾼 뒤
  더 높은 BUILDING version 하나만 ACTIVE로 만든다.
- 더 높은 BUILDING version도 최신 저장 version으로 간주한다. 따라서 낮은 version은 새로 stage하거나
  activate할 수 없다.
- activate는 내부 bigint만 받지 않고 stage에 사용한 job·tenant·curriculum·lesson·material identity를 함께
  검증한다.
- 같은 version의 `activate` 재호출은 성공으로 취급한다.
- material identity마다 ACTIVE는 partial unique index로 최대 하나다.
- 더 낮거나 같은 version의 지연 activate/delete/index는 현재 상태를 되돌릴 수 없다.

## 5. 멱등성과 삭제 tombstone

- `job_id`와 `idempotency_key`는 각각 unique다.
- 두 값과 작업 identity가 모두 같은 재호출만 기존 결과를 반환한다. 어느 필드든 재사용 의미가 달라지면
  실패한다.
- delete도 `MATERIAL_DELETE` job으로 기록하고 성공 상태를 남긴다.
- delete가 아직 BUILDING인 version을 제거하면 해당 RUNNING index job을 같은 transaction에서 CANCELLED로
  종료한다. FAILED/CANCELLED delete job identity는 재사용하지 않는다.
- 성공한 delete version 이하의 늦은 index는 tombstone이 차단하며, 더 높은 version만 새로 stage할 수 있다.
- 삭제 요청의 curriculum/lesson scope가 기존 material과 다르면 어떤 row도 삭제하지 않는다.

## 6. DB 권한과 운영 전제

- DBA는 migration 전에 `ai_app NOLOGIN NOINHERIT` group role을 만든다. role은 로그인·superuser·DB/role 생성,
  replication·RLS 우회 권한과 다른 role membership을 가지면 안 되며 `ai` schema owner여서도 안 된다.
- migration은 direct grant를 회수한 뒤에도 `PUBLIC` 등 간접 ACL로 `ai_app`에 schema CREATE가 남으면
  fail-closed한다.
- migration login은 `vector` extension과 `ai` schema/table을 만들 수 있어야 하며 별도
  `AI_WORKER_MIGRATION_DATABASE_URL`(`postgresql+psycopg`)을 사용한다.
- runtime login은 운영 단계에서 `ai_app` role membership을 받아야 한다.
- production runtime/migration role 이름의 기본값은 `ai_app`이다. repository와 migration은 안전한 PostgreSQL
  identifier만 받는 내부 role override를 지원하며, 자동 통합 테스트는 기존 cluster role과 충돌하지 않도록
  실행마다 고유한 `ai_app_*_test` role을 주입한다.
- `ai_app`은 이 revision의 5개 table DML과 4개 identity sequence 사용 권한만 가진다.
- `ai_app`은 `ai` schema에서 DDL할 수 없다. AI migration은 상대 소유인 `core` schema ACL을 수정하지 않으며,
  runtime login에 core 권한을 주지 않는 것은 DB provisioning 전제다.

## 7. 변경 규칙

차원, 식별자, 상태, idempotency, ordering, 권한 또는 table shape를 바꾸면 같은 MR에서 이 문서,
Alembic revision과 PostgreSQL 통합 테스트를 함께 갱신한다. Spring 메시지/API 필드를 추가하거나 바꾸는 경우
이 문서만으로 처리하지 않고 공유 계약과 양측 테스트를 포함하는 common MR로 승격한다.

## 8. PPTX ingestion 내부 계약

### 8.1 처리 순서와 실패 원자성

PPTX index use case는 아래 순서를 지킨다.

1. Python 내부 material identity와 embedding model identity를 검증한다.
2. source port에서 PPTX bytes를 읽는다.
3. bytes를 안전하게 검증·파싱하고 slide-aware chunk로 변환한다.
4. chunk text 순서대로 embedding을 요청하고 응답 계약을 검증한다.
5. 검증된 chunk 전체를 하나의 material version으로 `stage`한다.
6. stage가 성공한 경우에만 같은 material identity와 반환된 version id로 `activate`한다.

parse, chunk, embedding 또는 stage가 실패하면 activate를 호출하지 않는다. 지원되는 텍스트가 없는 유효한
PPTX, 잘못된 package, resource limit 초과와 embedding 응답 위반은 각각 typed ingestion error로 구분한다.
동기식 OOXML 파싱과 chunking은 event loop 밖의 `asyncio.to_thread`에서 실행한다. 다만 coroutine 취소가 이미
실행 중인 thread를 중단시키지는 않으므로 bounded executor, process isolation과 shutdown 정책은 runtime adapter가
책임진다.

### 8.2 PPTX package와 추출 규약

- source와 ZIP entry는 메모리에서만 읽으며 파일 시스템에 extract하지 않는다.
- required OPC part가 없거나 malformed인 일반 ZIP은 PPTX로 취급하지 않는다.
- 절대/상위 경로, backslash 경로, 정규화 시 충돌하는 entry 이름, duplicate entry, symlink와 암호화 entry를
  거부한다.
- source bytes, entry 수, entry별·전체 uncompressed bytes, compression ratio, slide·shape·block 수와 text
  characters에 명시적인 상한을 적용한다.
- 텍스트 shape, table cell과 발표자 노트를 slide 및 shape 순서대로 추출한다. notes part가 없는 slide를 읽기
  위해 template 파일을 열거나 생성하지 않는다.
- 외부 relationship의 대상은 다운로드하지 않는다. parser는 network I/O를 소유하지 않는다.
- 이미지 OCR, SmartArt, chart와 grouped shape 내부 텍스트는 현재 지원 범위가 아니다.

기본 resource limit은 다음과 같다.

| 경계 | 기본 상한 |
|---|---:|
| source bytes | 50 MiB |
| ZIP central directory bytes | 16 MiB |
| ZIP entry 수 | 10,000 |
| entry별 uncompressed bytes | 50 MiB |
| XML entry별 uncompressed bytes | 10 MiB |
| 전체 uncompressed bytes | 200 MiB |
| entry compression ratio | 1,000:1 |
| slide 수 | 5,000 |
| shape 수 | 100,000 |
| indexable block 수 | 100,000 |
| indexable text characters | 5,000,000 |
| relationship 수 | 100,000 |

구체적인 limit 기본값 변경은 보안·처리량 결정이므로 parser test와 이 문서를 같은 MR에서 갱신한다.

### 8.3 deterministic chunk 규약

- 서로 다른 slide의 block은 하나의 chunk로 합치지 않는다.
- block text는 Unicode NFC와 whitespace를 정규화한 뒤 안정적인 `(page, order)` 순서로 처리한다.
- 기본 strategy는 `slide-max-1200-v1`이다. 한 block이 최대 길이를 넘으면 공백 경계를 우선하고, 경계가 없으면
  최대 길이에서 hard split한다.
- `chunk_index`는 0부터 연속 증가하고 `page`는 1부터 시작한다.
- `content_hash`는 page identity와 정규화된 text를 함께 SHA-256으로 계산한다. 같은 문장이 다른 slide에 있으면
  다른 chunk identity가 된다.

chunk 최대 길이, 정규화, ordering 또는 hash 입력을 바꾸면 strategy version을 올리고 회귀 테스트를 함께
갱신한다.

### 8.4 embedding 경계

- use case 입력의 model은 `BAAI/bge-m3`, revision은 고정 hexadecimal commit, 차원은 1024여야 한다.
- embedding adapter의 선언 identity는 material 입력 identity와 일치해야 한다.
- adapter는 요청 text 하나마다 같은 순서로 vector 하나를 반환해야 한다.
- 각 vector는 정확히 1024개의 finite 값으로 이루어진 non-zero vector여야 한다. 위반 시 어떤 chunk도 stage하지
  않는다.
- remote adapter는 최대 batch 크기 4, 입력-출력 순서, 인증, timeout과 재시도 정책을 후속 runtime 계약에서
  강제한다.

### 8.5 transport와 소유권 경계

`StagedMaterial`, source/embedding/storage port와 snake_case field는 Python 내부 계약이다. Spring wire의
camelCase DTO를 그대로 domain 또는 DB model로 재사용하지 않고 adapter mapper에서 변환한다. Spring이 채택한
자료 source는 MinIO bucket/object key가 아니라 `assetId`이며, worker는 MinIO 자격증명을 소유하지 않는다.

이 코어 자체는 RabbitMQ consume/ACK/retry/DLQ, Spring callback, index 또는 원본 객체 삭제를 구현하지 않는다.
외부 통신과 메시지 수명주기는 9절 adapter와 consumer가 담당한다. 원본 객체는 Spring asset 도메인 소유이므로
AI worker가 삭제하지 않는다.

저장 fingerprint에는 embedding 값이 포함되므로 GPU 비결정적 출력으로 재시도 fingerprint가 달라질 수 있다.
runtime은 source/GPU 작업 전에 기존 job을 조회한다. BUILDING version이면 저장된 결과를 activate하고,
SUCCEEDED version이면 저장된 version id를 반환해 동일 job을 재임베딩하지 않는다.

## 9. Spring 자료 임베딩 연동 adapter 규약

이 절은 backend의 `aiintegration/README.md`, 루트 `docs/CONTRACT.md` §3-1/§3-2와 ADR-0036을 AI 소비자
관점에서 채택한다. 공유 필드와 상태코드는 루트 계약 문서를 정본으로 삼는다.

### 9.1 RabbitMQ wire envelope

queue는 durable `ingestion.embed`, exchange는 RabbitMQ default exchange, routing key는 queue 이름이다.
body는 UTF-8 JSON이며 모든 field는 camelCase다. adapter DTO는 알 수 없는 field와 지원하지 않는
`contractVersion`을 fail-closed로 거부한다.

`PPTX_EMBED` version 1:

```json
{
  "taskType": "PPTX_EMBED",
  "materialId": "uuid",
  "assetId": "uuid",
  "lessonId": "uuid",
  "curriculumId": "uuid",
  "fileName": "강의자료.pptx",
  "policy": { "embedModel": "bge-m3" },
  "contractVersion": 1
}
```

`EMBED_DELETE` version 1:

```json
{
  "taskType": "EMBED_DELETE",
  "materialId": "uuid",
  "lessonId": "uuid",
  "contractVersion": 1
}
```

- `fileName`은 빈 문자열일 수 있는 표시·관측용 값이며 source 권한이나 파일 형식 판정에 사용하지 않는다.
- wire model alias `bge-m3`는 Python 내부의 고정 model `BAAI/bge-m3`로만 매핑한다.
- embed envelope에는 source URL, bucket, object key, model revision, chunk 전략을 넣지 않는다. model revision,
  최대 batch와 chunk 전략은 AI 배포 설정이 소유한다.
- Spring outbox의 embed idempotency key는 body 밖의 `material:{materialId}:embed`다. consumer mapper는 현재
  version 1에서 동일한 값을 결정적으로 복원한다.
- 현재 envelope에는 재색인 version이 없다. material UUID가 attachment 실행마다 새 identity이고 한 번만
  index된다는 전제로 내부 `material_version=1`을 사용한다. 같은 material 재색인이 필요해지면 공유 계약에
  version을 추가한 뒤 이 규칙을 바꾼다.
- 현재 delete envelope는 curriculum, asset, version을 포함하지 않아 저장소의 scope·tombstone 계약으로 바로
  변환할 수 없다. 삭제 consumer는 별도 resolver 또는 공유 계약 보강 전까지 완료로 선언하지 않는다.

### 9.2 HMAC 원시 body 규약

Spring download-url 요청과 callback은 하나의 공유 secret을 사용한다. signature는 아래와 같다.

```text
X-Signature: base64(HMAC-SHA256(UTF-8 secret, rawBody))
```

서명한 `rawBody` bytes를 `Content-Type: application/json`으로 그대로 전송한다. HTTP client의 `json=` 옵션으로
재직렬화하지 않는다. secret과 presigned URL은 로그·예외·DB에 남기지 않는다.

### 9.3 주문형 PPTX source 획득

worker는 job 처리 직전에 아래 요청을 보낸다.

```http
POST /api/internal/ai/materials/download-url
X-Signature: <9.2 signature>
Content-Type: application/json

{"assetId":"<job assetId>"}
```

- 성공은 `200 {"url":"https://..."}`이며 worker는 받은 URL을 저장하거나 재사용하지 않고 즉시 GET한다.
- `401`은 secret 불일치 또는 배포 설정 오류인 non-retryable 실패다.
- `404`는 asset 없음·비-MATERIAL·미업로드 상태를 의도적으로 구분하지 않는다. consumer는 제한된 재시도 후
  영구 실패로 전환한다.
- URL 응답은 HTTP(S), userinfo 없음 조건을 만족해야 한다. GET은 redirect를 자동 추적하지 않는다.
- GET 전에 `Content-Length`가 있으면 50 MiB 상한을 검사하고, 없거나 실제 응답이 달라져도 streaming 누적
  bytes로 같은 상한을 강제한다.
- 허용 media type은 PPTX 정식 MIME과 `application/octet-stream`이다. response는 성공·실패·취소 모두 닫는다.
- presigned GET `401`·`403`은 URL 만료 가능성이 있으므로 상위 consumer가 새 URL부터 다시 발급하도록
  retryable로 분류한다. adapter 내부에서 같은 URL을 재사용해 재시도하지 않는다.

Python 내부의 기존 저장 column을 이번 adapter 단계에서 파괴적으로 바꾸지 않는다. compatibility locator로
`source_bucket="spring-asset"`, `source_object_key=<assetId UUID>`를 사용한다. 이 값은 실제 bucket/key가 아니라
source provider와 opaque source identity이며 MinIO 접근에 사용하지 않는다. column rename은 기존 data migration
전략과 함께 별도 저장소 MR에서 처리한다.

### 9.4 remote BGE runtime

- EC2↔GPU 공유 정본과 운영 endpoint는
  [`docs/CONTRACT.md` §3-7](../../docs/CONTRACT.md#3-7-ec2-ai-worker--gpu-bge-runtime-http--ai-구현됨)을
  따른다. 아래는 ai-worker adapter가 추가로 강제하는 검증 규칙이다.
- endpoint는 `POST /internal/v1/embeddings`, 인증은 BGE runtime 전용 Bearer token이다. Spring HMAC secret과
  공유하지 않는다.
- 요청 model은 `BAAI/bge-m3`, revision은 배포 설정의 40자리 고정 commit이며 최대 batch는 4다.
- adapter는 chunk 순서를 보존해 batch를 순차 호출하고 응답 model·revision·1024차원·정규화 flag·개수·finite
  non-zero vector를 검증한다.
- `400`·`409`·`413`·`422`는 계약 위반, network·`429`·`5xx`는 retryable runtime 실패다. adapter 자체는
  재시도하지 않고 consumer에 분류를 전달한다.

### 9.5 Spring 결과 callback

callback은 `POST /api/internal/ai/callbacks`에 9.2의 HMAC으로 보낸다.

```json
{
  "eventId": "uuid",
  "eventType": "MATERIAL_EMBEDDED",
  "jobId": "worker-side-job-id",
  "materialId": "uuid",
  "lessonId": "uuid",
  "status": "READY"
}
```

- 성공은 `204`다. `MATERIAL_EMBEDDED`는 READY, `MATERIAL_EMBED_FAILED`는 FAILED,
  `MATERIAL_EMBEDDING`은 PROCESSING으로 전이한다. `MATERIAL_DELETED`(status `DELETED`)·
  `MATERIAL_DELETE_FAILED`(status `FAILED`)는 §9.6의 삭제 전용 eventType이며, Spring이 아직
  매핑하지 않아 inbox에만 남는다.
- 같은 사건의 HTTP 재시도는 동일 `eventId`와 동일 raw body를 사용한다. 새로운 결과 사건만 새 event ID를
  만든다.
- index activate가 commit된 뒤에만 success callback을 보낸다. callback 실패로 message가 재전달되면 완료된
  DB job을 먼저 조회하고 재임베딩하지 않은 채 같은 callback을 재시도해야 한다.
- consumer는 terminal `MATERIAL_EMBEDDED`·`MATERIAL_EMBED_FAILED`만 발신한다. 응답 유실 뒤 별도 PROCESSING
  event가 READY/FAILED 상태를 되돌리는 것을 피하기 위해 `MATERIAL_EMBEDDING`은 현재 발신하지 않는다.
- Spring은 body 형식 미달도 204로 무시하므로 Python contract test가 필수 field를 발신 전에 강제한다.

### 9.6 RabbitMQ consumer 수명주기

- consumer는 `AI_WORKER_MATERIAL_INGESTION_ENABLED=true`일 때만 시작한다. 기본값은 false다.
- Spring이 소유한 durable `ingestion.embed`는 passive lookup한다. consumer는 main queue를 다른 argument로
  재선언하지 않는다.
- prefetch는 1이다. message 하나의 handler와 terminal callback이 성공한 뒤에만 원본을 ACK한다.
- 일시 실패는 `x-ai-retry-count`를 1씩 올려 persistent message를 default exchange의 `ingestion.embed`로 먼저
  publish-confirm한 뒤 원본을 ACK한다. 기본 retry는 3회, 지연은 5초에서 시작하는 지수 backoff이며 최대 300초다.
  지연 중에는 원본 message를 unacked로 유지하므로 worker가 종료되면 broker가 원본을 다시 전달한다.
- 잘못된 envelope, non-retryable 실패, retry 소진 message는 AI가 선언한 durable `ingestion.embed.dlq`에
  먼저 publish-confirm한 뒤 원본을 ACK한다. DLQ publish가 실패하면 원본을 `nack(requeue=true)`해 유실을 막는다.
- retry 소진 시 DB가 이미 SUCCEEDED면 FAILED callback을 보내지 않는다. 이는 READY callback만 실패한 성공 작업의
  상태를 FAILED로 덮지 않기 위한 규칙이다.
- consumer 등록과 RabbitMQ·PostgreSQL 연결, BGE `/readyz`가 모두 정상일 때만 management readiness를 true로 둔다.
- 종료 요청은 새 delivery를 취소하고 진행 중인 작업 하나를 기본 30초 drain한다. 제한을 넘기면 task를 취소하고
  ACK하지 않은 원본은 broker 재전달 대상으로 남긴다.

`EMBED_DELETE`는 payload에 없는 `curriculum_id`를 `materialId`로 `ai.material_version`을 조회해
self-lookup한 뒤 삭제한다([ADR-0006](../../docs/decisions/jinwoo/0006-pptx-material-delete-resolution.md)).
조회 결과가 없으면(이미 삭제됐거나 존재한 적 없음) 성공(멱등)으로 끝내고 실제 삭제를 시도하지 않는다.
성공은 `MATERIAL_DELETED`(status `DELETED`), 실패는 `MATERIAL_DELETE_FAILED`(status `FAILED`)
콜백으로 보낸다 — 둘 다 Spring이 아직 처리하지 않는 eventType이라 inbox에만 남고 자료 상태는
바뀌지 않는다(루트 `docs/CONTRACT.md` §3-2). Python consumer와 Spring의
`MATERIAL_EMBEDDING_ENABLED`를 모두 켜지 않는다.

## 10. GMS 핵심 용어 추출과 Spring 전달 (선택 기능)

이 절은 9절의 Spring 자료 임베딩 wire 계약과 독립이다. `AI_WORKER_KEY_TERM_EXTRACTION_ENABLED=true`일
때만 동작하며, 기본값(`false`)에서는 이 절의 어떤 호출도 발생하지 않고 8절의 embedding/storage 흐름과
100% 동일하게 동작한다. 설계 근거는
[ADR-0003](../../docs/decisions/jinwoo/0003-pptx-key-term-extraction-approach.md)을 따른다.

### 10.1 GMS endpoint와 인증

```http
POST https://api.openai.com/v1/chat/completions
Authorization: Bearer <AI_WORKER_GMS_API_KEY>
Content-Type: application/json
```

- `AI_WORKER_GMS_API_KEY`는 ai-api의 `AI_API_GMS_API_KEY`와 같은 GMS 게이트웨이 키를 재사용할 수 있지만,
  Spring HMAC secret이나 BGE Bearer token과는 절대 공유하지 않는다.
- 요청은 `openai` SDK(`AsyncOpenAI`)로 구성하며 `response_format: {"type": "json_schema", ...}`로
  구조화 출력을 강제한다. 자유 텍스트 파싱에 의존하지 않는다.

### 10.2 GMS 요청 입력과 응답 규약

- 입력은 PPTX 전체 텍스트를 슬라이드 순서대로 이어붙이고 `[슬라이드N]` 구분자로 슬라이드 경계를 표시한
  단일 문자열이다(8.3의 chunk와 별개로, chunk 이전 `ParsedPresentation`에서 직접 구성한다).
- 입력이 `AI_WORKER_GMS_MAX_PROMPT_CHARS`(기본 100,000자)를 넘으면 앞부분만 잘라서 보낸다.
- system prompt는 PPTX 텍스트를 신뢰하지 않는 데이터로 명시하고, 텍스트 안에 포함된 지시·명령을 따르지
  말라고 강제한다(prompt injection 방어).
- 성공 응답은 `{"terms": [{"term": "...", "definition": "..."}]}` 형태다. 스키마를 벗어나면 응답 계약
  위반으로 처리하고, `term`/`definition`은 domain의 `KeyTerm(term, definition)`으로만 변환한다.
- adapter(`GmsKeyTermExtractor`)는 API 오류·응답 계약 위반을 모두 `KeyTermExtractionError`로만
  표면화한다. 원문, API key, 원본 응답 body를 로그에 남기지 않는다. adapter 자체는 재시도하지 않는다.

### 10.3 application 계층의 실패 격리와 재시도 캐시

- `IndexPptxMaterial.execute()`는 `key_term_extractor`가 설정된 경우에만 embedding과
  `asyncio.gather`로 동시에 추출을 시도한다. 추출 예외는 전부 잡아서 경고 로그만 남기고 빈 결과로
  대체한다 — **핵심 용어 추출 실패는 8절의 embedding/stage/activate 흐름을 절대 막지 않는다.**
- `execute()`는 추출된 용어를 DB에 저장하지 않고 `MaterialIndexResult(version_id, key_terms)`로
  호출자에게 반환한다. 다만 추출에 성공하면([ADR-0004](../../docs/decisions/jinwoo/0004-key-term-callback-delivery-timing.md))
  `IndexPptxMaterial` 인스턴스 자신의 in-memory 캐시(`job_id -> key_terms`, 최대 1,000개, 초과 시
  가장 오래된 항목 제거)에도 적어둔다.
- `find_existing` 단축 경로(9.6의 idempotent 재시도 처리)를 탈 때는 이 캐시에서 `job_id`로 조회해
  `key_terms`를 채운다. 캐시에 없으면(다른 프로세스 인스턴스, 또는 worker 재시작 이후) 빈 tuple을
  반환한다 — 이건 in-memory 캐시의 알려진 한계이며, RabbitMQ의 유한 재시도 창(9.6, 최대 300초
  backoff) 안에서 같은 프로세스가 살아있는 한 캐시가 채워져 있을 확률이 높다는 전제에 기댄다.

### 10.4 Spring 전달 — `MATERIAL_EMBEDDED`에 `keyTerms` 포함

핵심 용어는 별도 eventType이 아니라 **기존 9.5의 `MATERIAL_EMBEDDED`(READY) callback 하나에 실어서**
전달한다. `consumers/material_job.py`의 `MaterialJobHandler`는 `execute()` 결과의 `key_terms`가
비어있지 않으면 그대로 담아 **한 번만** 보낸다.

```http
POST /api/internal/ai/callbacks HTTP/1.1
X-Signature: <9.2의 HMAC>
Content-Type: application/json

{
  "eventId": "uuid",
  "eventType": "MATERIAL_EMBEDDED",
  "jobId": "worker-side-job-id",
  "materialId": "uuid",
  "lessonId": "uuid",
  "status": "READY",
  "keyTerms": [
    { "term": "지도학습", "definition": "정답(레이블)이 있는 데이터로 모델을 학습시키는 방식" }
  ]
}
```

- `keyTerms`는 `MATERIAL_EMBEDDED`에서만 존재할 수 있는 optional 필드다. `MATERIAL_EMBEDDING`이나
  `MATERIAL_EMBED_FAILED`에 실려 있으면 계약 위반으로 거부한다. 값이 없으면(추출 비활성이거나 빈
  결과) 직렬화 시 필드 자체가 생략된다(`exclude_none`) — 이 필드가 생기기 전의 `MATERIAL_EMBEDDED`
  wire 형태와 완전히 동일하다.
- 이 callback은 9.5/9.6과 **동일한 필수·재시도 계약**을 따른다. 별도의 best-effort 경로는 없다 —
  전송이 실패하면 9.6의 규칙대로 job 전체가 재시도되고, 재시도 시 `keyTerms`가 채워지는지는 10.3의
  in-memory 캐시 히트 여부에 달려 있다.
- Spring 쪽 실제 처리(`AiCallbackService`에서 `keyTerms` 필드를 받아 저장하는 로직)는 이 문서가 다루는
  ai-worker 범위 밖이며 아직 구현되지 않았다 — 지금은 알 수 없는 필드로 조용히 무시된다. Java 쪽 계약
  (`AiCallbackEvent` record에 `keyTerms` 필드 추가 등)은 backend 팀이 별도로 정한다.

## 11. 강조 판서 스냅샷 색인 (ADR-0043)

이 절은 9절 자료 임베딩과 **같은 큐·같은 HMAC·같은 callback endpoint**를 쓰는 두 번째 잡 계열이다.
공유 wire 정본은 루트 `docs/CONTRACT.md` §3-1/§3-2이며, 여기서는 Python 적용 규칙만 정한다.
요청 배경은 [ADR-0074](../../docs/decisions/songjeongki/0074-annotation-highlight-evidence-contract.md),
설계 결정은 [ADR-0043](../../docs/decisions/canola/0043-annotation-timeline-evidence-mvp.md)을 따른다.

### 11.1 잡 envelope

`ANNOTATION_EMBED` version 1:

```json
{
  "taskType": "ANNOTATION_EMBED",
  "snapshotId": "uuid",
  "assetId": "uuid",
  "sessionId": "uuid",
  "lessonId": "uuid",
  "curriculumId": "uuid",
  "sessionMs": 725300,
  "capturedAt": "2026-08-04T13:20:05+09:00",
  "interpretedText": "B+ tree 노드 분할 조건",
  "policy": { "embedModel": "bge-m3" },
  "contractVersion": 1
}
```

`ANNOTATION_EMBED_DELETE` version 1:

```json
{ "taskType": "ANNOTATION_EMBED_DELETE", "snapshotId": "uuid", "contractVersion": 1 }
```

- 두 잡은 `PptxEmbedJob`·`EmbedDeleteJob`과 같은 `taskType` discriminator union에 속하며 같은
  `parse_material_job`이 파싱한다. 알 수 없는 field와 지원하지 않는 `contractVersion`은 fail-closed다.
- `snapshotId`가 멱등 키다. 같은 값의 재발행은 기존 색인을 교체한다.
- `curriculumId`는 검색 스코프, `sessionMs`는 다시보기 타임라인 앵커다. `sessionMs`는 0 이상이어야 한다.
- `capturedAt`은 offset이 있는 timestamp여야 한다. naive 값은 실제 타임라인에 놓을 수 없어 거부한다.
- `interpretedText`는 생략 가능하고 2,000자를 넘을 수 없다. 상한은 `ai.annotation_snapshot.text`와
  같은 값이며, 저장할 수 없는 텍스트를 조용히 자르지 않고 거부해 DLQ에 보존한다.
- delete envelope는 `snapshotId`만 받는다. 삭제에 lesson/curriculum scope를 요구하지 않으므로
  자료 삭제(§9.6)와 달리 self-lookup resolver가 필요 없다.

### 11.2 이미지 획득

`assetId`로 §9.3과 **같은** `POST /api/internal/ai/materials/download-url`을 호출해 갓 서명된
presigned GET을 받는다. 판서 전용 경로를 새로 만들지 않는다. 허용 media type과 크기 상한만 자료와
다르다 — `image/png`(또는 `application/octet-stream`), 최대 4 MiB다. 상한은 `Content-Length`와
실수신 bytes 양쪽에서 강제하므로 header가 없거나 거짓이어도 무한 읽기가 되지 않는다.

긴 변이 1,568px을 넘으면 거부하지 않고 종횡비를 유지해 축소한 뒤 모델에 보낸다. 강사가 이미 확인한
근거를 비용 때문에 버리지 않으면서 vision tile 과금을 제한하기 위해서다. 한도 안의 이미지는
재인코딩하지 않고 원본 bytes를 그대로 전달한다. 디코드·축소는 `asyncio.to_thread`에서 실행하며
5천만 픽셀을 넘는 입력은 decompression bomb으로 거부한다.

### 11.3 결과 callback

`POST /api/internal/ai/callbacks`에 §9.2의 HMAC으로 보낸다.

```json
{
  "eventId": "uuid",
  "eventType": "ANNOTATION_EMBEDDED",
  "jobId": "ANNOTATION_EMBED:<snapshotId>",
  "snapshotId": "uuid",
  "status": "READY"
}
```

- body에 `materialId`·`lessonId`가 없다. Spring은 `snapshotId`만으로 스냅샷 상태를 확정한다.
- `eventId`는 `(jobId, eventType)`에서 결정적으로 파생하므로 같은 결과의 HTTP 재시도가 같은 값을 쓴다.
- `ANNOTATION_EMBEDDING`(PROCESSING)은 계약에 존재하지만 §9.5와 같은 이유로 발신하지 않는다 —
  응답 유실 뒤의 늦은 PROCESSING이 READY/FAILED를 되돌리는 것을 막는다.
- Spring은 이 eventType들을 아직 매핑하지 않아 현재는 inbox에만 남는다.
- **`ANNOTATION_EMBED_DELETE`는 callback을 보내지 않는다.** ADR-0074가 정의한 eventType 3종은 모두
  색인용이고 `ANNOTATION_DELETED`에 해당하는 값이 없다. `ANNOTATION_EMBEDDED/READY`를 쓰면 삭제된
  스냅샷을 "색인됨"으로 알리게 되므로 사실과 반대다. 성공은 무응답이고 영구 실패는 DLQ가 운영
  신호다. 삭제 결과를 Spring이 확인해야 한다면 오너 합의로 eventType을 추가한 뒤 배선한다.

### 11.4 기능 스위치

`AI_WORKER_ANNOTATION_INGESTION_ENABLED`(기본 `false`)가 켜졌을 때만 색인·삭제 use case가 조립된다.
`AI_WORKER_MATERIAL_INGESTION_ENABLED`와 독립이며, 켜려면 `AI_WORKER_GMS_API_KEY`가 필요하다 —
Spring이 `interpretedText` 없이 보낸 스냅샷은 이미지를 읽어야만 색인할 수 있으므로 잡마다 실패하게
두지 않고 기동 시점에 요구한다.

OCR 모델은 `AI_WORKER_ANNOTATION_MODEL`로 따로 지정한다. 강조 이미지를 읽으려면 vision 모델이
필요하지만 §10의 핵심 용어 추출은 PPTX 텍스트만 다루므로 두 용도를 한 값에 묶지 않는다. 비어 있으면
`AI_WORKER_GMS_MODEL`로 폴백하므로 구분이 필요 없는 배포는 아무것도 설정하지 않아도 된다. API key와
timeout은 두 용도가 공유한다.

꺼진 상태에서 annotation 잡이 도착하면 영구 실패로 처리해 `ingestion.embed.dlq`에 보존한다. ACK도
requeue도 하지 않는 제3의 보존은 RabbitMQ에 없고 requeue는 재전달 루프를 만든다. 스위치를 켠 뒤
DLQ를 재발행하면 그대로 처리되므로 배포 순서가 어긋나도 잡이 유실되지 않는다.
