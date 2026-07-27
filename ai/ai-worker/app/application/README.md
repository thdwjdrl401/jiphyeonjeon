# `ai-worker/app/application`

PPTX 한 version을 파싱·임베딩·저장·활성화하는 유스케이스다.

## 역할

- asset bytes를 읽고 parsing/chunking을 worker thread로 offload한다.
- embedding identity·차원·순서·개수를 검증한다.
- 모든 chunk를 stage한 뒤에만 같은 material version을 activate한다.

## 구조와 흐름

```text
read_pptx -> parse/chunk -> embed -> ChunkRecord -> stage -> activate
```

## 파일 구성

`index_pptx_material.py`가 `IndexPptxMaterial`과 내부 변환을 구현한다.

## 경계와 불변식

- 빈 자료, embedding 오류, stage 실패에서는 activate하지 않는다.
- RabbitMQ, HTTP, MinIO SDK를 직접 알지 않는다.
- cancellation과 typed ingestion 오류를 숨기지 않는다.

## 검증

`uv run --frozen pytest -q tests/test_index_pptx_material.py`
