# `ai-worker/app/application`

PPTX 한 version을 파싱·임베딩·저장·활성화하는 유스케이스(`IndexPptxMaterial`)와, 자료 삭제
유스케이스(`DeleteMaterialIndex`)를 담는다.

## 역할

- asset bytes를 읽고 parsing/chunking을 worker thread로 offload한다.
- embedding identity·차원·순서·개수를 검증한다.
- 모든 chunk를 stage한 뒤에만 같은 material version을 activate한다.
- v2가 `extractKeyTerms=true`를 명시하면 PPTX 전체 텍스트에서 핵심 용어+정의를 embedding과
  `asyncio.gather`로 동시에 추출한다. v1은 기존 feature flag 동작을 유지한다.
- 추출·저장 결과를 `READY|EMPTY|FAILED`로 구분해 material version에 영속화한다. 용어 실패는
  embedding/stage/activate를 막지 않지만 terminal callback에 독립 상태로 보고한다.
- `DeleteMaterialIndex`는 `EMBED_DELETE` job(materialId·lessonId만 있음)을 받아
  `IndexStorage.resolve_active_scope`로 curriculum_id와 현재 버전을 self-lookup한 뒤 `delete_job`을
  호출한다(ADR-0006). 조회 결과가 없으면(이미 삭제됐거나 존재한 적 없음) `delete_job`을 호출하지
  않고 바로 성공(멱등)으로 끝낸다.

## 구조와 흐름

```text
read_pptx -> parse/chunk -> embed -> ChunkRecord -> stage ---------> activate
                         -> (선택) GMS 핵심 용어 추출 -> 결과/용어 저장 --^
```

`execute()`는 `MaterialIndexResult(version_id, key_term_result, chunk_count)`를 반환한다. 이 계층은
Spring에 직접 보내지 않고 `consumers/material_job.py`가 callback을 발신한다. 재배달 단축 경로는
material version에 저장한 결과 메타데이터와 `ai.material_key_term`을 읽어 같은 callback 결과를
재구성하므로 worker 프로세스 메모리에 의존하지 않는다.

## 파일 구성

`index_pptx_material.py`가 `IndexPptxMaterial`·`MaterialIndexResult`, `delete_material_index.py`가
`DeleteMaterialIndex`·`MaterialDeleteResult`, `map_material_job.py`가 wire job → 내부 identity 변환
(`map_pptx_embed_job`, `map_embed_delete_job`, `embed_delete_job_id`)을 구현한다.

## 경계와 불변식

- 빈 자료, embedding 오류, stage 실패에서는 activate하지 않는다.
- RabbitMQ, HTTP, MinIO SDK를 직접 알지 않는다.
- cancellation과 typed ingestion 오류를 숨기지 않는다.
- 핵심 용어 추출·저장 실패는 embedding 실패로 전파하지 않고 `key_term_result=FAILED`로 반환한다.
- `MaterialIndexResult.key_term_result`는 상위 consumer가 Spring callback의 상태·개수로 전달한다.
  원문 용어와 결과 메타데이터는 AI 스키마가 소유하며 재시작 후 callback 재구성의 SSOT다
  ([ADR-0003](../../../../docs/decisions/jinwoo/0003-pptx-key-term-extraction-approach.md),
  [ADR-0004](../../../../docs/decisions/jinwoo/0004-key-term-callback-delivery-timing.md),
  [ADR-0005](../../../../docs/decisions/jinwoo/0005-key-term-storage-schema.md)).
- `DeleteMaterialIndex`는 wire의 `lesson_id`를 그대로 `delete_job`에 넘긴다 — 실제 저장된 값과
  다르면 `delete_job` 내부의 스코프 검증이 이미 거부하므로 별도 검증을 추가하지 않는다
  ([ADR-0006](../../../../docs/decisions/jinwoo/0006-pptx-material-delete-resolution.md)).

## 검증

`uv run --frozen pytest -q -p no:cacheprovider tests/test_index_pptx_material.py tests/test_pgvector_repository.py tests/test_delete_material_index.py`
