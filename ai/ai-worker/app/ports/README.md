# `ai-worker/app/ports`

PPTX ingestion core가 외부 구현을 호출하는 protocol 경계다.

## 역할

- `MaterialAssetStore.read_pptx`
- `TextEmbeddingModel`의 identity와 positional batch embedding
- `IndexStorage.find_existing/stage/activate` — 색인, `resolve_active_scope/delete_job` — 삭제
  (`resolve_active_scope`는 materialId만으로 curriculum_id·현재 버전을 self-lookup한다, ADR-0006)
- `KeyTermExtractor.extract` — PPTX 전체 텍스트에서 `KeyTerm`(용어+정의) 목록 추출(선택 기능)
- `KeyTermStorage.store_result/load_result` — 용어와 `READY|EMPTY|FAILED` 결과를 자료 버전에
  영속하고 재배달 시 복구한다(`store`는 v1 호환용)

## 구조와 흐름

```text
IndexPptxMaterial    -> IndexStorage, KeyTermExtractor, KeyTermStorage <- runtime adapter
DeleteMaterialIndex  -> IndexStorage                                   <- runtime adapter
```

## 파일 구성

`material_ingestion.py`에 여섯 protocol, `__init__.py`에 공개 export가 있다.

## 경계와 불변식

- SDK response나 SQL row를 signature에 노출하지 않는다.
- embedding 입력·출력 순서를 보존한다.
- 현재 asset/embedding runtime adapter는 후속 구현이다.

## 검증

fake port를 사용하는 `tests/test_index_pptx_material.py`, `tests/test_delete_material_index.py`로
검증한다.
