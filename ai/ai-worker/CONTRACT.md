# ai-worker RAG index storage contract

이 문서는 Python `ai-worker` 내부의 repository↔PostgreSQL 저장 규약이다. Spring/Java의 RabbitMQ payload,
callback API 또는 공유 DTO 규약이 아니며 Java 연동 완료를 뜻하지 않는다. 외부 메시지 규약은 Java 담당자가
함께 채택하는 별도 common MR 전까지 확정하지 않는다.

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
