# `ai-worker/migrations/versions`

적용 순서가 고정된 `ai` schema revision을 보관한다.

## 역할

- job/model/material version, document chunk, vector embedding 저장 구조를 만든다.
- upgrade와 소유 객체만 제거하는 downgrade를 기록한다.

## 구조와 흐름

현재 최초 revision은 `0001_rag_index_storage.py`다.

## 파일 구성

해당 revision이 pgvector, table, constraint, HNSW/FTS index와 runtime grant를 정의한다.

## 경계와 불변식

- 적용된 revision을 수정하지 않고 후속 변경은 새 revision으로 추가한다.
- downgrade는 파괴적이므로 운영에서 임의 실행하지 않는다.

## 검증

`tests/test_storage_migration_contract.py`와 격리 PostgreSQL 통합 테스트를 사용한다.
