# ai-worker RAG index storage and PPTX ingestion core contract

이 문서는 Python `ai-worker` 내부의 repository↔PostgreSQL 저장 규약과 transport-neutral PPTX ingestion
코어 규약이다. Spring/Java의 RabbitMQ payload, callback API 또는 공유 DTO 규약이 아니며 Java 연동 완료를
뜻하지 않는다. 외부 메시지 규약은 Java 담당자가 함께 채택하는 별도 common MR 전까지 확정하지 않는다.

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

`StagedMaterial`, source/embedding/storage port와 snake_case field는 Python 내부 계약이다. `curriculum_id`에
대응하는 wire 후보 `curriculumId`를 포함해 어떤 필드도 Spring/Java가 채택한 JSON/message 계약으로 선언하지
않는다. source version, idempotency, delete scope, source acquisition도 공유 계약에서 아직 확정되지 않았다.

따라서 이 코어는 RabbitMQ consume/ACK/retry/DLQ, MinIO stat·MIME·download guard, callback/outbox, index 또는
원본 객체 삭제를 구현하지 않는다. Java 측 채택이 필요한 기능은 AI 브랜치에서 단독 확정하지 않고 담당자와
공유 계약·양측 계약 테스트를 포함하는 별도 common MR에서 채택한다. 실제 MinIO, RabbitMQ와 remote BGE
E2E도 각 adapter 도입 MR의 검증 책임이다.

저장 fingerprint에는 embedding 값이 포함되므로 GPU 비결정적 출력으로 재시도 fingerprint가 달라질 수 있다.
runtime은 completed-job short circuit 또는 durable result/outbox를 설계하기 전 동일 job을 무조건 재임베딩하지
않는다.
