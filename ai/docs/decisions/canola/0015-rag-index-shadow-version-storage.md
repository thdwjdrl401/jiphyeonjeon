# ADR-0015: RAG index를 shadow version과 delete tombstone으로 저장한다

- 상태: Accepted (AI-only scope)
- 일자: 2026-07-27
- 범위: `ai/ai-worker`

> 위치 메모: 이번 MR은 사용자가 `ai/**` 밖 수정을 금지했기 때문에 AI-local 경로에 기록한다. 팀 정본 ADR
> 경로인 `docs/decisions/canola/`로의 승격은 해당 경로 수정 승인을 받은 별도 문서 변경에서 수행한다.

## 배경

PPTX 재처리 중 기존 검색 인덱스를 먼저 지우거나 chunk를 부분 commit하면 질의 결과가 사라지거나 서로 다른
자료 version이 섞인다. RabbitMQ 재전달과 순서 역전까지 고려하면 단순 upsert/delete만으로는 최신 상태를
보장할 수 없다. 저장소는 현재 Java payload와 아직 합의되지 않았으므로 Java wire contract도 이 MR에서
확정할 수 없다.

## 결정

1. `ai` schema에 job, model, material version, chunk, embedding을 분리한다.
2. 새 index는 BUILDING shadow version으로 한 transaction에 stage하고, 완성 후 별도 transaction에서 ACTIVE로
   전환한다. material별 ACTIVE는 하나만 허용한다.
3. `(tenant_id, material_id)` advisory transaction lock과 version 비교로 concurrent/stale activate와 delete를
   직렬화한다. 더 높은 BUILDING version도 낮은 stage/activate를 차단한다.
4. 성공한 delete를 `job_run` tombstone으로 유지해 같은 version 이하의 지연 index 부활을 막는다.
5. material의 curriculum/lesson scope는 최초 기록 뒤 불변으로 두어 잘못된 scope의 재index/delete를 막는다.
6. canonical chunk fingerprint를 version에 저장해 같은 job/version의 다른 입력을 멱등 성공으로 오인하지
   않는다. activate도 stage identity와 내부 version id를 함께 검증한다.
7. BUILDING 자료 삭제 시 진행 중 index job을 CANCELLED로 terminal 처리하고 delete tombstone은 유지한다.
8. runtime은 사전 provisioning된 `ai_app NOLOGIN NOINHERIT` 최소 권한 role로 DML하고, migration은 별도
   psycopg DDL DSN을 사용한다. migration은 `core` ACL이나 다른 서비스 소유 객체를 수정하지 않는다.
9. BGE-M3 revision을 고정하고 1024차원 finite non-zero vector를 unit norm으로 저장하며 cosine HNSW를 쓴다.
10. 이 경계는 Python 내부 저장 계약으로만 선언한다. Spring 메시지/callback 채택은 별도 common MR에서 양측
   계약 테스트와 함께 결정한다.

## 결과

- index 생성 실패가 현재 ACTIVE 자료를 손상시키지 않는다.
- 재전달, concurrent activate, 지연 delete/index의 결과가 단조적이다.
- 새 version을 만들기 때문에 저장 공간과 정리 비용이 늘어난다.
- advisory lock key와 tombstone history를 보존해야 한다.
- migration login에 extension/role 생성 권한이 필요하고 runtime login membership은 운영 단계에서 따로
  설정해야 한다.

## 검토한 대안

- 기존 row in-place 갱신: 중간 실패 시 부분 index가 노출되어 제외했다.
- stage 전에 기존 version 삭제: 새 index 실패 시 서비스 가능한 검색 결과가 없어져 제외했다.
- message delivery 순서만 신뢰: RabbitMQ 재전달과 consumer 병렬 실행에서 보장되지 않아 제외했다.
- Java payload를 이 MR에서 확정: Java 수정 금지와 양측 채택 원칙을 위반하므로 제외했다.

## 검증

- pure unit test로 식별자/embedding/URL validation과 normalization을 검증한다.
- opt-in PostgreSQL+pgvector 통합 테스트로 migration, 권한, transaction rollback, idempotency, 동시 activation,
  scope 불변성과 stale delete/index ordering을 검증한다.
