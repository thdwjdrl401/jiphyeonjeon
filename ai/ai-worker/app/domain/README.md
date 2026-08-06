# `ai-worker/app/domain`

자료 index 저장에 필요한 순수 도메인 모델과 typed 오류다.

## 역할

- `StagedMaterial`의 scope·version·model identity를 검증한다.
- `ChunkRecord`의 page·hash·1024차원 finite vector를 검증한다.
- `AnnotationHighlight`/`AnnotationRecord`의 session_ms·offset·비어 있지 않은 text를 검증한다.
- stale version, invalid PPTX, limit, empty content, embedding 계약 오류를 구분한다.

## 구조와 흐름

외부 adapter가 만든 값을 application과 storage가 공유하는 불변 모델로 고정한다.

## 파일 구성

`index_models.py`는 값 모델, `annotation_models.py`는 강조 판서 모델, `errors.py`는 ingestion 오류
계층, `__init__.py`는 공개 API다.

## 경계와 불변식

- BGE model은 `BAAI/bge-m3`, embedding은 1024차원이다.
- material/curriculum ID는 `UUID`, version은 양수다. lesson ID는 `UUID` 또는 `None`이며,
  `None`은 커리큘럼 스코프 자료를 뜻한다.
- transport DTO가 아니며 Java wire 계약으로 재사용하지 않는다.

## 검증

`tests/test_index_models.py`, `tests/test_index_annotation_highlight.py`와 application/storage
테스트에서 검증한다.
