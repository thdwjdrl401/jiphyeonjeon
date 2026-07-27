# `ai-worker/app/ports`

PPTX ingestion core가 외부 구현을 호출하는 protocol 경계다.

## 역할

- `MaterialAssetStore.read_pptx`
- `TextEmbeddingModel`의 identity와 positional batch embedding
- `IndexStorage.stage/activate`

## 구조와 흐름

```text
IndexPptxMaterial -> port <- runtime adapter
```

## 파일 구성

`material_ingestion.py`에 세 protocol, `__init__.py`에 공개 export가 있다.

## 경계와 불변식

- SDK response나 SQL row를 signature에 노출하지 않는다.
- embedding 입력·출력 순서를 보존한다.
- 현재 asset/embedding runtime adapter는 후속 구현이다.

## 검증

fake port를 사용하는 `tests/test_index_pptx_material.py`로 검증한다.
