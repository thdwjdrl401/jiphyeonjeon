# `ai-worker/app/application`

PPTX 한 version을 파싱·임베딩·저장·활성화하는 유스케이스다.

## 역할

- asset bytes를 읽고 parsing/chunking을 worker thread로 offload한다.
- embedding identity·차원·순서·개수를 검증한다.
- 모든 chunk를 stage한 뒤에만 같은 material version을 activate한다.
- `key_term_extractor`가 설정된 경우, PPTX 전체 텍스트에서 핵심 용어+정의를 embedding과
  `asyncio.gather`로 동시에 추출한다. extractor가 없으면(기본값) 이 경로는 아예 타지 않아 기존
  동작과 100% 동일하다. 추출 실패는 로그만 남기고 삼켜서 embedding/stage/activate를 막지 않는다.

## 구조와 흐름

```text
read_pptx -> parse/chunk -> embed -> ChunkRecord -> stage -> activate
                         -> (선택) GMS 핵심 용어 추출 -> MaterialIndexResult.key_terms
```

`execute()`는 `MaterialIndexResult(version_id, key_terms)`를 반환한다. 이 계층은 용어를 저장하거나
Spring에 보내지 않고 반환만 한다 — 실제 Spring 콜백 발신은 `consumers/material_job.py`가 담당한다.

## 파일 구성

`index_pptx_material.py`가 `IndexPptxMaterial`, `MaterialIndexResult`와 내부 변환을 구현한다.

## 경계와 불변식

- 빈 자료, embedding 오류, stage 실패에서는 activate하지 않는다.
- RabbitMQ, HTTP, MinIO SDK를 직접 알지 않는다.
- cancellation과 typed ingestion 오류를 숨기지 않는다.
- 핵심 용어 추출 실패는 예외이며 embedding/저장 경로의 실패와 다르게 처리한다(삼키고 계속 진행).
- 추출된 용어는 이 계층에서 저장하지 않는다. `MaterialIndexResult.key_terms`로 반환해 상위(consumer)가
  Spring 콜백으로 보내도록 위임한다([ADR-0003](../../../../docs/decisions/jinwoo/0003-pptx-key-term-extraction-approach.md)).

## 검증

`uv run --frozen pytest -q tests/test_index_pptx_material.py`
