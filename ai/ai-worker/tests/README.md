# `ai-worker/tests`

worker 골격, ingestion core와 PostgreSQL 저장 계약을 검증한다.

## 역할

- 설정·로그·management lifecycle을 검증한다.
- PPTX 보안 parsing, chunking, embedding 계약을 검증한다.
- migration·권한·idempotency·concurrency·version 전환을 실제 PostgreSQL로 검증한다.

## 구조와 흐름

단위 테스트와 자동 생성되는 격리 `liveclass_ai_*_test` DB 통합 테스트로 나뉜다.

## 파일 구성

파일명은 `config`, `management/runtime/main`, `pptx/chunker/application`, `pgvector/migration` 검증
대상을 그대로 나타낸다.

## 경계와 불변식

- Java의 `liveclass` DB와 기존 role을 수정하지 않는다.
- PostgreSQL이 없으면 통합 테스트를 skip하지 않고 실패시킨다.
- transport가 아직 없으므로 RabbitMQ/MinIO E2E가 있다고 표현하지 않는다.

## 검증

```bash
cd ai/ai-worker
uv run --frozen pytest -q -p no:cacheprovider
```
