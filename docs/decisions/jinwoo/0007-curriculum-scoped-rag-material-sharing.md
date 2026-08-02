# ADR-0007: RAG PPTX 자료 검색 범위를 lesson에서 curriculum으로 확장

- **상태**: 채택
- **일자**: 2026-07-30
- **관련**: `ai/ai-api/app/rag/models.py`, `ai/ai-api/app/rag/service.py`,
  `ai/ai-api/app/rag/retrieval.py`, `ai/ai-api/app/retrieval/`,
  `ai/ai-api/app/adapters/pgvector_material_retrieval.py`

## 맥락 (Context)

지금 RAG 질문·답변은 자료 검색을 `lesson_id` 하나로만 스코프한다 — 학생이 어떤 세션(lesson)에서
질문하면, **그 세션에 업로드된 PPTX 자료 안에서만** 검색한다. 요구사항은 "같은 커리큘럼 안의
세션들이 서로 PPTX 자료 내용을 공유해서 RAG가 답변할 수 있어야 한다"는 것이다 — 즉 A 세션에
올라간 자료를 B 세션에서 질문할 때도 근거로 쓸 수 있어야 한다.

`ai.material_version` 테이블에는 이미 `curriculum_id` 컬럼이 있고(migration `0001_rag_index_storage`,
불변 필드), unique 제약은 `(tenant_id, material_id, material_version)`이라 lesson 단위로 잠겨있지
않다. 즉 **저장 구조는 그대로 두고 검색 스코프만 넓히면** 요구사항을 만족할 수 있다.

## 결정

### 검색 스코프: lesson_id → curriculum_id

- `ai/ai-api/app/adapters/pgvector_material_retrieval.py`의 SQL을
  `WHERE mv.lesson_id = :lesson_id`에서 `WHERE mv.curriculum_id = :curriculum_id`로 바꾼다.
- 이 변경을 따라 `PgvectorActiveMaterialRepository.search_active`, `ActiveMaterialSearchPort`,
  `ActiveMaterialRetrievalService.retrieve`, `MaterialRetrievalPort`,
  `CombinedEvidenceRetriever.retrieve`까지 매개변수를 `lesson_id` → `curriculum_id`로 바꾼다.
- `MaterialChunkHit`에 `curriculum_id` 필드를 추가해 SQL 결과에서 그대로 실어온다.

### RagAnswerRequest에 curriculumId 추가 (Spring 계약 변경 필요)

지금 Spring이 RAG 질문 요청(`RagAnswerRequest`)에 `lessonId`만 보내고 `curriculumId`는 보내지 않는다.
"이 질문이 어느 curriculum 소속인지"를 ai-api가 스스로 알아낼 방법이 없어서(자체 DB 역추론은 자료가
없는 신규 세션에서 실패하므로 기각), **Spring이 `curriculumId`를 요청에 같이 보내주는 것으로
결정했다.** `RagAnswerRequest`에 `curriculumId: UUID` 필드를 추가한다.

이 필드는 공유 wire 계약(`docs/CONTRACT.md` §3-1 영역)에 속하므로, 실제로 Spring이 이 필드를
채워 보내도록 하는 변경은 backend 팀과 별도로 협의·반영해야 한다. ai-api 쪽은 이 필드를 **받을
준비**까지만 이번 변경으로 끝낸다 — Spring이 아직 안 보내는 동안은 계약 검증에서 막힌다(필수 필드
누락으로 요청 자체가 거부됨).

### 자막(caption) 증거는 그대로 lesson 단위 유지

PPTX 자료만 커리큘럼 단위로 넓히고, 실시간 자막(caption) 증거는 지금처럼 `lesson_id`+`sessionId`로
엄격하게 스코프한다 — 자막은 "지금 이 세션에서 실제로 말한 내용"이라 다른 세션과 공유할 이유가
없다. 이를 위해 `RetrievedEvidence`에 `curriculum_id: UUID | None` optional 필드를 추가하고,
`_validate_evidence_scope`(`app/rag/service.py`)를 evidence 종류별로 분기한다.

```python
for item in evidence:
    if isinstance(item.source, PptxSource):
        if item.curriculum_id != request.curriculumId:
            raise _EvidenceScopeViolation
    elif isinstance(item.source, CaptionSource):
        if item.lesson_id != request.lessonId or item.source.sessionId != request.sessionId:
            raise _EvidenceScopeViolation
```

## 대안 (기각)

| 대안 | 판단 |
|---|---|
| ai-api가 자체 DB에서 lesson_id → curriculum_id 역추론(자기 lesson의 기존 자료로 조회) | 자료 없는 신규 세션은 자기 curriculum을 못 찾아 다른 세션 자료를 아예 못 씀 — 요구사항(공유)의 핵심 사례를 놓침 |
| lesson_id 스코프를 유지하고 검색을 여러 lesson_id에 대해 반복 실행 | Spring이 "이 curriculum의 lesson 목록"을 매번 넘겨야 하고, N+1 쿼리 구조가 되어 더 복잡함. curriculum_id 컬럼이 이미 있는데 안 쓰는 것도 낭비 |

## 영향·후속 (Consequences)

- **Spring 쪽 필수 작업**: `RagAnswerRequest`에 상응하는 Spring 발신 payload에 `curriculumId`를
  채워 보내야 한다. 이건 이 ADR의 ai-api 구현 범위 밖이며 backend 팀 후속 작업이다. 그 전까지는
  ai-api가 요청을 계약 위반(필수 필드 누락)으로 거부한다.
- `docs/CONTRACT.md`(루트, 공유 정본)의 RAG 질문 요청 필드 목록도 `curriculumId` 추가를 반영해야
  하지만, 이 파일은 jinwoo 소유가 아니라 직접 수정하지 않는다 — backend 팀과 함께 반영해야 한다.
- 자료가 커리큘럼 전체에서 검색되므로, 한 세션에서 다른 세션 자료를 근거로 답변이 나올 수 있다.
  프론트엔드/강사 입장에서 "이 자료가 어느 세션 것인지" 출처 표시가 필요할 수도 있다 — 현재
  `PptxSource`는 `materialId`/`page`만 담고 `lessonId`는 없다. 필요해지면 별도로 추가한다(범위 밖).
- 강사 지정 커리큘럼 삭제/재구성 시 `curriculum_id`가 바뀌는 경우는 없다는 전제(§1 불변 필드)가
  계속 성립해야 한다 — 이 전제가 깨지면 검색 스코프 자체가 잘못될 수 있다.
