# `ai-worker/migrations/versions`

적용 순서가 고정된 `ai` schema revision을 보관한다.

## 역할

- job/model/material version, document chunk, vector embedding 저장 구조를 만든다.
- upgrade와 소유 객체만 제거하는 downgrade를 기록한다.

## 구조와 흐름

현재 revision chain은 `0001_rag_index_storage.py` → `0002_material_key_terms.py` →
`0003_annotation_highlight.py` → `0004_annotation_text_unbounded.py` →
`0005_material_key_term_result.py`다.

## 파일 구성

- `0001`: pgvector, material version, chunk/embedding, HNSW/FTS index와 runtime grant
- `0002`: material version별 핵심 용어·정의
- `0003`: 강조 판서 검색 색인
- `0004`: 강조 판서 설명 text 길이 제한 제거
- `0005`: 핵심 용어 terminal 상태·개수·절단·실패 코드

## 경계와 불변식

- 적용된 revision을 수정하지 않고 후속 변경은 새 revision으로 추가한다.
- downgrade는 파괴적이므로 운영에서 임의 실행하지 않는다.

## 검증

`tests/test_storage_migration_contract.py`와 격리 PostgreSQL 통합 테스트를 사용한다.
