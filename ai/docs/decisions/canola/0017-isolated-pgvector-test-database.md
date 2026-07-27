# ADR-0017: pgvector 통합 테스트 DB를 자동 격리한다

- 상태: Accepted (AI-only scope)
- 일자: 2026-07-27
- 범위: `ai/ai-worker` 테스트 하네스

> 위치 메모: 사용자 요청으로 변경 범위를 `ai/**`에 한정했기 때문에 AI-local ADR에 기록한다. 팀 정본
> `docs/decisions/` 승격은 해당 경로 수정이 허용된 별도 문서 MR에서 수행한다.

## 배경

RAG 저장소 통합 테스트는 Alembic upgrade/downgrade, fixture schema 삭제와 role 검증을 수행한다. 따라서 Java와
Python이 함께 사용하는 `liveclass` DB를 대상으로 실행할 수 없고, 기존에는 세 가지 환경변수를 명시한 경우에만
16개 테스트를 실행했다. 이 opt-in 방식은 개발 중 기본 pytest가 저장소 회귀를 계속 건너뛰게 만들었다.

## 결정

1. 기본 pytest는 개발용 PostgreSQL 서버의 `postgres` 관리 DB에 연결해 고유한 `liveclass_ai_*_test` DB를
   session마다 생성한다.
2. migration, pgvector repository와 destructive fixture는 이 임시 DB에서만 실행하고 session 종료 시 해당 DB만
   삭제한다.
3. PostgreSQL role은 cluster 전역이므로 실행마다 고유한 `ai_app_*_test NOLOGIN NOINHERIT` role도 함께 만들고
   제거한다. 기존 운영 `ai_app` role은 읽거나 변경하지 않는다.
4. Java가 사용하는 `liveclass` DB와 그 `core` schema는 읽거나 수정하지 않는다.
5. 기본 compose 계정에서는 환경변수를 요구하지 않는다. 계정이나 포트를 바꾼 경우에만
   `AI_WORKER_TEST_ADMIN_URL` 하나로 관리 연결을 재정의한다.
6. PostgreSQL이 없거나 DB·role 생성/삭제 권한이 없으면 integration test를 skip하지 않고 전체 테스트를
   실패시킨다.
7. 기존의 명시적 test runtime/migration URL 방식은 CI 호환을 위해 유지하며, 이 경우 `_test` suffix와
   `AI_WORKER_ALLOW_DESTRUCTIVE_TEST_DB=1` 안전장치를 계속 강제한다.

## 결과

- 기본 테스트 결과에서 PostgreSQL skip이 사라지고 저장소 회귀가 매 변경마다 실행된다.
- Java 개발 DB와 같은 PostgreSQL 컨테이너를 재사용하지만 database 단위로 파괴적 fixture를 격리한다.
- 로컬 테스트는 실행 중인 PostgreSQL과 `CREATEDB` 권한을 요구한다.
- 비정상 종료로 임시 DB가 남을 수 있으나 다음 실행과 이름이 충돌하지 않으며 수동 제거할 수 있다.

## 검토한 대안

- 공유 `liveclass` DB의 임시 schema 사용: migration과 role/권한 테스트가 schema 밖 상태도 다뤄 Java DB를
  손상시킬 수 있어 제외했다.
- 환경변수 opt-in 유지: 기본 회귀 검사에서 16개가 계속 누락되어 제외했다.
- 테스트마다 별도 PostgreSQL 컨테이너 시작: 격리는 강하지만 실행 시간과 Docker orchestration 복잡도가 커서,
  이미 실행 중인 pgvector 서버 안의 임시 DB를 우선 사용한다.

## 검증

- 환경변수 없이 전체 pytest를 실행해 pgvector 통합 테스트를 포함한 zero-skip 결과를 확인한다.
- 테스트 전후 `liveclass` DB와 자동 생성된 test DB 목록을 확인해 공유 DB가 유지되고 임시 DB만 제거되는지
  검증한다.
