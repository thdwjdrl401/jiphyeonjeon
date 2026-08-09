# ADR-0112: 자료 검색은 자료가 붙은 자리를 지킨다

> 관련 결정: [jinwoo/ADR-0007 검색 범위를 lesson→curriculum으로 확장](../jinwoo/0007-curriculum-scoped-rag-material-sharing.md)(**부분 대체**) ·
> [canola/ADR-0045 커리큘럼 종속 자료 색인](../canola/0045-curriculum-scoped-material-indexing.md) ·
> [공유 계약 §9](../../ai/CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-08-10
- **적용 범위**: ai-api의 PPTX 자료 검색(`ACTIVE_MATERIAL_HYBRID_SQL` 및 그 위 계층)

## 맥락

강사가 물었다 — "AI 질문에 근거로 같은 부분이 3개씩 나온다".

운영 데이터가 이유를 바로 보여 줬다. 한 커리큘럼에 **같은 파일이 15개 강의에 붙어** 청크 120개가
쌓여 있었다.

```
demo_deadlock.pptx   연결 28회(커리큘럼 3 + 강의 25) · ai 버전 24 · 청크 192

커리큘럼별 사본
  c19bc860…   15개  (청크 120)
  31934cfb…    3개  (청크 24)   ← "3개씩"이 나온 그 커리큘럼
```

검색이 커리큘럼 전체를 훑으므로 이 사본들이 **전부 후보**가 되고, 텍스트가 같으니 같은 문단이
사본 수만큼 근거로 올라온다.

그런데 더 중요한 것은 중복이 아니라 **범위**였다. 검색 조건이 이랬다.

```sql
WHERE mv.curriculum_id = CAST(:curriculum_id AS uuid)
  AND mv.state = 'ACTIVE'
```

`lesson_id`는 `SELECT`로 실려 나오기만 하고 `WHERE`에 한 번도 쓰이지 않았다.
`RagAnswerRequest.lessonId`는 **필수 필드로 받고 있었지만 검색까지 내려가지 않았다**. 즉 1강에서
물어본 질문에 7강 자료가 근거로 올라왔다.

### 문서가 이미 이 규칙을 적고 있었다

[공유 계약 §9](../../ai/CONTRACT.md):

> - **커리큘럼 종속 자료**: 커리큘럼 전체에서 **항상** 참조.
> - **강의(레슨) 종속 자료**: 해당 강의 문맥에서 **추가로** 참조.

[ADR-0045 §2](../canola/0045-curriculum-scoped-material-indexing.md)는 같은 사고를 **실패 모드로**
지목해 두기까지 했다.

> 레슨 잡이 `lessonId`를 잃으면 조용히 커리큘럼 전체 자료가 되어, **한 강의 자료가 커리큘럼 모든
> 질문의 근거로 새어 나간다.**

다만 그 가드는 **인제스천 payload**에만 걸렸고, 검색에는 걸리지 않았다. 그래서 payload가 멀쩡해도
검색 단계에서 똑같은 일이 벌어졌다.

### ADR-0007과의 충돌

[ADR-0007](../jinwoo/0007-curriculum-scoped-rag-material-sharing.md)은 반대를 요구사항으로 적었다.

> A 세션에 올라간 자료를 B 세션에서 질문할 때도 근거로 쓸 수 있어야 한다.

**이 ADR은 그 요구를 되돌린다.** 다만 통째로가 아니라, 그 요구를 만족시키는 **다른 수단**이 그
사이에 생겼다는 점이 근거다 — ADR-0045의 **커리큘럼 종속 자료**다. 강의를 가로질러 공유하고 싶은
자료는 이제 커리큘럼에 붙이면 되고, 그것이 `lesson_id IS NULL`로 표현된다. 공유 여부를 **강사가
붙이는 자리로 결정**하게 되었으므로, 검색이 임의로 넓힐 이유가 사라졌다.

## 결정

### 1. 검색은 자료가 붙은 자리를 그대로 지킨다

```sql
WHERE mv.curriculum_id = CAST(:curriculum_id AS uuid)
  AND mv.state = 'ACTIVE'
  AND (mv.lesson_id IS NULL OR mv.lesson_id = CAST(:lesson_id AS uuid))
```

`lesson_id IS NULL`이 곧 커리큘럼 종속이므로(ADR-0045 §1), **규칙이 조건 한 줄로 그대로 표현된다.**
스코프를 나타내는 별도 컬럼을 만들지 않은 선택이 여기서 값을 한다.

### 2. `lesson_id`를 검색 계층까지 내린다

`MaterialRetrievalPort` · `ActiveMaterialRetrievalService.retrieve` · `ActiveMaterialSearchPort` ·
`PgvectorActiveMaterialRepository.search_active`가 모두 `lesson_id`를 **필수**로 받는다. 선택 인자로
두면 넘기는 것을 잊은 호출부가 조용히 옛 동작으로 돌아간다 — 이 사고가 정확히 그렇게 일어났다.

`RagAnswerRequest.lessonId`는 이미 필수 필드다. **계약 변경은 없다.**

### 3. 중복 사본은 이 ADR의 범위 밖이다

같은 파일을 여러 강의에 붙이면 사본마다 임베딩된다(비용). 스코프를 지키면 **한 강의에서 보이는
중복은 사라지지만**, 사본 자체는 남는다. 근본 해법은 "공유할 자료는 커리큘럼에 한 번만 붙인다"이며,
이는 화면 안내와 데이터 정리의 문제다. 검색 단계의 텍스트 중복 제거도 별도로 다룬다.

## 결과

- 1강에서 물으면 **1강 자료 + 커리큘럼 자료**만 근거가 된다.
- 같은 파일이 여러 강의에 붙어 있어도 한 강의에서는 **그 강의 사본 하나만** 후보가 된다.
- 커리큘럼에 붙인 자료는 어느 강의에서 물어도 나온다 — 공유 수단은 그대로 남는다.
- 매 질문이 훑는 후보가 줄어 검색 비용도 함께 준다.

## 검증

- `test_real_postgres_keeps_a_lesson_material_inside_its_own_lesson`(실제 pgvector) — 같은 커리큘럼의
  **옆 강의 ACTIVE 자료가 빠지는지**, 다른 커리큘럼과 RETIRED도 여전히 빠지는지. 이 테스트는 이번에
  **뒤집은 것**이다(전 이름: `..._shares_active_chunks_across_lessons_in_the_same_curriculum`).
- `test_curriculum_scoped_material_with_no_lesson_is_searchable` — 커리큘럼 종속 자료는 **아무 강의**로
  물어도 나온다(테스트가 임의의 `lesson_id`를 넘긴다).
- `test_repository_sql_enforces_role_active_curriculum_scope_and_maps_hits` — SQL에 조건이 있는지.
- `test_service_normalizes_query_embedding_before_scoped_search` — 서비스가 `lesson_id`를 저장소까지
  **넘기는지**. 조건만 있고 값이 안 내려가면 소용이 없다.
- **돌연변이 확인**: SQL에서 그 조건 한 줄을 지우면 **2건이 깨진다**(단위 1 + 실제 DB 1).
- ai-api **432건** 통과 · ruff check·format 통과.
