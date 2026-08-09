# ADR-0115: 용어집도 커리큘럼 자료를 모은다

> 관련 결정: [songjeongki/ADR-0064 용어집은 두 겹이다](0064-lesson-glossary-two-layers.md)(범위 보강) ·
> [canola/ADR-0045 커리큘럼 종속 자료 색인](../canola/0045-curriculum-scoped-material-indexing.md) ·
> [songjeongki/ADR-0112 검색은 붙은 자리를 지킨다](0112-material-search-respects-the-scope-it-was-attached-to.md) ·
> [songjeongki/ADR-0114 커리큘럼 자료도 v2 잡을 쓴다](0114-curriculum-material-uses-the-same-v2-job-as-a-lesson.md)

- **상태**: 채택
- **일자**: 2026-08-10
- **적용 범위**: `LessonGlossaryService.glossary` — AI가 뽑은 원본 용어를 읽는 범위

## 맥락

[ADR-0114](0114-curriculum-material-uses-the-same-v2-job-as-a-lesson.md)를 배포한 직후 강사가 다시
물었다 — "머지했는데 **아직도** 핵심 용어가 안 올라온다".

배포 뒤 올린 자료를 확인하니 파이프라인은 끝까지 정상이었다.

```
core.material_asset    임베딩 READY · 핵심어 READY      ← ADR-0114가 여기까지 고쳤다
ai.material_version    ACTIVE · lesson_id NULL
ai.material_key_term   12개
```

**용어 12개가 저장돼 있는데 화면에는 하나도 뜨지 않았다.** 마지막 구간이 남아 있었다.

```sql
WHERE mv.lesson_id = :lessonId
  AND mv.activated_at IS NOT NULL
  AND mv.retired_at IS NULL
```

용어집이 원본을 읽는 조건이 **강의로만** 걸린다. 커리큘럼에 붙인 자료는 정의상 `lesson_id IS NULL`이라
([ADR-0045](../canola/0045-curriculum-scoped-material-indexing.md) §1) **구조적으로 배제된다.**

### 같은 뿌리에서 두 번째다

[ADR-0112](0112-material-search-respects-the-scope-it-was-attached-to.md)에서 고친 것과 같은 종류인데
**방향이 반대**다.

| | 걸렀던 기준 | 결과 |
|---|---|---|
| 자료 검색(ADR-0112 전) | `curriculum_id`만 | 강의 자료가 옆 강의로 **샜다** |
| 용어집(이 ADR 전) | `lesson_id`만 | 커리큘럼 자료가 **빠졌다** |

같은 표(`ai.material_version`)를 읽으면서 한쪽은 커리큘럼으로, 한쪽은 강의로 걸렀다. 그래서 **같은
자료가 근거로는 나오는데 용어로는 안 나오는** 상태가 됐다.

## 결정

### 1. 조건을 검색과 같은 모양으로 맞춘다

```sql
WHERE mv.curriculum_id = :curriculumId
  AND (mv.lesson_id IS NULL OR mv.lesson_id = :lessonId)
  AND mv.activated_at IS NOT NULL
  AND mv.retired_at IS NULL
```

"커리큘럼 자료는 전부, 강의 자료는 그 강의만"이라는 한 문장이 두 경로에서 **같은 모양의 조건**으로
쓰인다. 다음에 이 규칙이 필요한 세 번째 자리가 나와도 옮겨 적을 것이 분명해진다.

옛 버전을 거르는 두 조건(`activated_at`·`retired_at`)은 그대로다 — 다시 올린 자료의 옛 용어가 자막에
링크로 남는 것을 막는 조건이고, 이 변경과 무관하다.

### 2. 커리큘럼을 묻는 일은 curriculum에게 맡긴다

용어집은 `lessonId`만 받으므로 범위를 모른다. `LessonLearningAccess`에 `curriculumIdOf(lessonId)`를
더하고 **curriculum 모듈이 구현한다**.

이 포트는 이미 같은 이유로 존재한다 — 구현체 주석이 그렇게 적고 있다.

> learning이 선언한 `LessonLearningAccess`를 curriculum이 구현한다 — 레슨→섹션→커리큘럼→수강
> 관계는 **curriculum 쪽 지식**이다.

learning이 섹션 표를 직접 읽지 않고, 이미 있는 경계를 그대로 쓴다. 의존 방향도 그대로다(순환 없음).

## 결과

- 커리큘럼에 붙인 자료의 용어가 그 커리큘럼의 **모든 강의 용어집**에 합류한다.
- 이미 색인된 자료도 **재처리 없이 바로 뜬다** — 용어는 진작 저장돼 있었고 읽지 못했을 뿐이다.
  (`ADR-0114`와 다른 점이다. 그쪽은 잡 봉투가 문제라 다시 돌려야 했다.)
- 강사 수정본이 원본을 덮는 [ADR-0064](0064-lesson-glossary-two-layers.md)의 두 겹 규칙은 그대로다.
  커리큘럼 자료의 용어도 그 "원본" 층에 들어갈 뿐이다.
- 계약 변경 없음.

## 검증

`ai` 스키마는 남의 것이라 테스트에서 채우지 않는 것이 이 저장소의 규칙이다
(`LessonGlossaryContractTest`의 주석). 그래서 **배선과 조건을 각각** 고정한다 — 둘 중 하나만 어긋나도
이 사고는 재발한다.

- `LessonGlossaryCurriculumScopeTest.the_glossary_asks_for_the_curriculum_scope_not_just_the_lesson`
  — 서비스가 `curriculumIdOf`로 범위를 얻어 저장소까지 넘기는지.
- `..._the_source_query_includes_curriculum_scoped_materials` — `@Query`를 읽어 조건이 실제로 들어
  있는지, 옛 버전 제외 조건이 남아 있는지.
- **돌연변이 확인**: 조건을 `mv.lesson_id = :lessonId`로 되돌리면 후자가 깨진다.
- 백엔드 **766건** 통과.

## 남은 일

- **`ai` 원본을 실제로 채우는 통합 테스트가 없다.** 위 두 테스트는 배선과 조건을 각각 볼 뿐, 둘을
  이어 실제 행이 나오는 것까지는 확인하지 못한다. 남의 스키마를 쓰지 않는다는 규칙과 맞바꾼 값이며,
  이 사고가 두 번 난 자리인 만큼 다시 볼 값어치가 있다.
