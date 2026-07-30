# ADR-0005: 레슨에 초안 상태를 두지 않는다 — 공개 축은 커리큘럼 하나

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-07-30
- **관련**: 브랜치 `refactor/be-fe/lesson-no-draft-state`, [seominkyeong/0002](0002-curriculum-and-lesson-publish-axes.md)(**대체**), [songjeongki/0021](../songjeongki/0021-lesson-publish-mvp-direct.md)(**대체**), [seominkyeong/0001](0001-draft-only-curriculum-delete.md)(유지)

## 맥락 (Context)

공개 여부를 결정하는 상태가 **두 개**였고 서로 독립이었다.

| 축 | 값 | 바꾸는 API |
|---|---|---|
| 커리큘럼 `lifecycleStatus` | DRAFT · PUBLISHED · ARCHIVED | `POST /instructor/curriculums/{id}/publish` |
| 레슨 `status` | DRAFT · PUBLISHED (AI_NOT_READY·READY는 미사용) | `POST /instructor/lessons/{id}/publish`·`/unpublish` |

수강생이 강의를 보려면 **둘 다 PUBLISHED여야** 했다. [ADR-0002](0002-curriculum-and-lesson-publish-axes.md)는
이 문제를 화면에서 풀었다 — 게시 버튼 하나가 초안 강의를 일괄 게시한 뒤 커리큘럼을 공개하는
2단 오케스트레이션을 클라이언트가 맡았다. 그 결정은 증상은 가렸지만 원인은 남겼다.

남은 문제:

- **막다른 상태가 여전히 만들어진다.** "게시 강의 5/5"인데 커리큘럼이 DRAFT면 실제 공개는 0이다.
  반대로 커리큘럼만 공개하면 목차가 빈 커리큘럼이 카탈로그에 올라간다. 화면이 두 축을 묶어
  실행해도, 부분 실패·API 직접 호출·다른 화면에서 축이 다시 갈린다.
- **레슨 축이 실어 나르는 정보가 없다.** AI_NOT_READY·READY에는 도달 경로가 아예 없었고
  ([ADR-0021](../songjeongki/0021-lesson-publish-mvp-direct.md)), 남은 DRAFT/PUBLISHED는
  커리큘럼 공개 여부를 되풀이할 뿐이다. 강사 화면의 `게시됨`/`준비 중` 배지는 언제나 커리큘럼
  상태와 같은 값을 반복해서 보여 줬다.
- **부수 복잡도가 크다.** 게시/게시취소 엔드포인트 2개, 상태 전이 검증, mock의 축 정합 보정,
  FE의 `publishLesson` 일괄 호출·부분 실패 처리, 목차 조회의 PUBLISHED 필터, 재생 접근의
  PUBLISHED 게이트가 모두 이 축 하나 때문에 존재했다.

## 결정 (Decision)

1. **레슨 `status`는 값이 하나다 — `PUBLISHED`.** 레슨은 만들어지는 순간 게시 상태이고 되돌릴
   상태가 없다. `DRAFT`·`AI_NOT_READY`·`READY`를 enum·DDL·화면에서 제거한다.
2. **레슨 발행·게시취소 API를 제거한다.** `POST /instructor/lessons/{id}/publish`·`/unpublish`와
   서비스·포트 메서드를 없앤다. 레슨 CRUD는 **생성·수정·삭제**뿐이다.
3. **공개 여부는 커리큘럼 `lifecycleStatus`만으로 결정한다.** 공개 목차는 레슨 상태로 거르지 않고,
   레슨 접근 판정(`access`)도 관계(OWNER_INSTRUCTOR·ENROLLED) 하나만 본다. 재생 접근에서도
   레슨 상태 게이트를 없앤다 — 비공개 커리큘럼은 수강 자체가 성립하지 않아 수강 게이트가 막는다.
4. **커리큘럼 게시 버튼은 커리큘럼 상태 하나만 바꾼다.** 누르는 순간 그 안의 강의가 함께 공개된다.
   '커리큘럼만 게시' 우회로는 존재 이유가 사라져 제거한다.
5. **강의 상태 표시를 화면에서 없앤다.** 관리 화면 강의 행과 커리큘럼 상세 목차의 게시 배지를
   제거한다. 라이브·다시보기 진행 배지는 실제로 변하는 정보라 남긴다.
6. **강의 삭제는 수정 화면에서만 한다.** 관리 화면 목록의 행별 삭제 버튼을 없앤다.
7. **응답 필드 `status`는 남긴다.** 값이 하나여도 공유 계약이 레슨 상태 필드를 `status`로
   규정하고([CONTRACT §1](../../CONTRACT.md)) FE가 그 필드를 읽는다. 필드 자체를 없애면 계약이 깨진다.

## 근거 (Rationale)

- **[ADR-0002](0002-curriculum-and-lesson-publish-axes.md)를 뒤집는 이유**: 그 결정은 "서버 축은
  분리로 두고 화면이 오케스트레이션한다"였다. 실제로 써 보니 화면이 두 축을 묶어도 축이 둘이라는
  사실 자체가 계속 새어 나왔다 — 부분 실패 처리, mock 정합 보정, 배지가 늘 같은 값을 반복하는 문제.
  **오케스트레이션은 축을 줄이지 못한다.** 축을 하나로 줄이면 그 모든 코드가 필요 없어진다.
- **[ADR-0021](../songjeongki/0021-lesson-publish-mvp-direct.md)을 대체하는 이유**: 그 결정의 목적은
  "AI 준비도를 게시 전제로 걸지 않는 것"이었고 여전히 유효하다. 다만 그 결론이 남긴
  "레슨 게시는 별도 command"는 이제 지킬 대상이 없다 — 게이팅할 전제가 없는 command다.
  CP2에서 AI 준비도가 살아나면 **레슨 상태가 아니라 라이브 시작 전제**로 걸면 된다
  (이미 preflight readiness가 그 자리에 있다).
- **비공개 커리큘럼의 강의가 새지 않는 이유**: 카탈로그는 `findByIdAndLifecycleStatus(id, PUBLISHED)`로
  커리큘럼을 찾고 아니면 404다. 목차를 만드는 `buildOutline`에 도달했다는 것은 이미 커리큘럼이
  공개됐다는 뜻이므로, 그 안의 레슨을 거르지 않아도 비공개 커리큘럼의 강의는 노출되지 않는다.
- **`AI_NOT_READY`·`READY`까지 없애는 이유**: 요청은 "초안 제거"였고 이 두 값은 그 범위 밖이라 남길
  수도 있었다. 확인해 보니 **레슨에 이 값을 설정하는 코드가 어디에도 없다** — 등장하는 곳은 enum
  선언과 Swagger 설명 문자열뿐이고, `AiCallbackService`의 `"READY"`는 자료 임베딩 상태
  (`updateEmbeddingStatus(materialId, …)`)로 레슨과 무관하다. `ai_ready_at` 컬럼도 쓰는 코드가 없다.
  그런데 이 결정으로 **목차의 레슨 상태 필터를 없앴기 때문에**, 값을 남겨 두면
  "커리큘럼 공개 + 레슨 `AI_NOT_READY`"가 성립하고 그 강의는 게이트 없이 수강생에게 노출된다 —
  값은 있는데 그 값을 존중하는 코드가 없는 상태다. 지금은 아무도 설정하지 않아 사고가 없지만
  CP2에서 누가 설정하는 순간 조용히 새어 나간다. CHECK 제약을 한 값으로 좁혀 **DB가 거부**하게 두는 편이
  안전하다. 대가는 CP2에서 제약을 넓히는 마이그레이션 1건이고, 그건 평범한 비용이다.
- **`published_lesson_count`를 남기는 이유**: 강사 목록 응답의 공유 계약 필드다. 모든 레슨이
  PUBLISHED가 되어 값이 `lesson_count`와 같아지지만, 카운터 자체는 여전히 정확하고 트리거도
  그대로 동작한다. 지우면 계약이 깨지므로 건드리지 않는다.
- **삭제를 수정 화면으로 옮기는 이유**: 관리 화면은 강의가 행으로 나열되고 각 행에 삭제 버튼이
  있었다. 목록에서 한 번의 오클릭으로 강의가 사라지는 자리다. 수정 화면까지 들어온 사람은 대상을
  분명히 알고 있고, 그 화면에는 되돌릴 수 없는 동작을 놓을 자리(danger zone)가 이미 있다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| **(선택) 레슨 축 제거, 커리큘럼 축만 남김** | 막다른 상태가 구조적으로 불가능, 엔드포인트 2개·게이트 3곳·mock 보정·FE 일괄 게시 로직 제거 | DB 마이그레이션 필요, 레슨 단위 비공개 준비 불가 |
| (기각) [ADR-0002](0002-curriculum-and-lesson-publish-axes.md) 유지(화면 오케스트레이션) | 변경 없음 | **실제로 써 보고 되돌림** — 축이 둘이라는 사실이 부분 실패·mock 정합·중복 배지로 계속 새어 나왔다 |
| (기각) 커리큘럼 축 제거, 레슨 축만 남김 | 강의 단위 공개 가능 | 커리큘럼이 카탈로그의 단위다. 커리큘럼 없이 강의만 공개할 자리가 없고 보관(ARCHIVED)도 커리큘럼 개념이다 |
| (기각) 서버에서 커리큘럼 publish가 레슨을 연쇄 게시 | 축은 남기고 화면은 단순 | 축이 둘인 문제가 그대로다. API 한 번으로 되돌릴 수 없는 노출이 일어난다 |
| (기각) 레슨 status를 응답에서도 제거 | 가장 깔끔 | FE가 읽는 공유 계약 필드다([CONTRACT §1](../../CONTRACT.md)) — 없애면 계약 위반 |

## 영향·후속 (Consequences)

- **BE 변경**: `LessonStatus`가 `PUBLISHED` 하나. `LessonManagement`에서 `publish`/`unpublish` 제거,
  `create`가 즉시 PUBLISHED로 저장. `InstructorCurriculumService.publishLesson`·`unpublishLesson`과
  컨트롤러 엔드포인트 2개 삭제. `LessonDirectory.findPublishedBySections` → `findBySections`
  (상태 필터 제거). `CatalogService`의 목차 필터·`lessonAccess`의 `LESSON_NOT_PUBLISHED`·
  `lessonDetail`의 ENROLLED 게이트 제거. `LessonPlaybackAccessImpl`의 PUBLISHED 게이트 제거.
- **DB 변경**: `V10__lesson_single_published_state.sql` — 남은 비게시 레슨을 PUBLISHED로 승격,
  CHECK 제약을 한 값으로 좁힘, DEFAULT 변경, 컬럼 코멘트 갱신. `published_lesson_count`와
  트리거는 유지.
- **FE 변경**: `publishLesson`·`unpublishLesson`을 인터페이스·http·mock·facade에서 제거.
  `LessonDetailPage`의 게시 토글·상태 배지 제거. `CurriculumPublishPanel`이 커리큘럼 하나만
  다루도록 단순화(props 3개 감소, '커리큘럼만 게시' 제거). 관리 화면 강의 행은 상세·수정 두 링크만.
  `LessonFormPage`에 삭제 danger zone 추가. mock 레슨은 항상 PUBLISHED.
- **계약 자물쇠**: 공유 계약이 바뀐다(엔드포인트 2개 제거, `status` 값 집합 축소) — [POLICY](../../harness/POLICY.md)의
  "계약 테스트 필수"에 해당한다. `LessonPublishContractTest`(216줄)를 삭제하고, 레슨 발행을 셋업으로
  쓰던 8개 계약 테스트에서 그 호출을 걷어냈다. 새 성질은 두 곳에서 못 박는다:
  `StudentLessonContractTest.enrolled_student_opens_newly_created_lesson_without_publish_step`
  (공개 커리큘럼에 만든 강의는 게시 단계 없이 즉시 열린다),
  `InstructorLessonContractTest.create_lesson_returns_201_published_camelCase`(생성 응답이 PUBLISHED).
  FE는 `CurriculumWorkspace.test.tsx`에 게시 1회로 강의가 함께 공개되는 흐름·우회로 부재·
  관리 행의 상세·수정만 있음을, mock 정합은 "강의는 커리큘럼이 초안이어도 게시 상태"로 고정했다.
- **되돌릴 수 없는 데이터 변경**: 마이그레이션이 기존 초안 레슨을 PUBLISHED로 올린다. 되돌리려면
  어느 레슨이 초안이었는지 알아야 하는데 그 정보는 남지 않는다. 다만 비공개 커리큘럼의 강의는
  마이그레이션 전후 모두 외부에 보이지 않으므로 **노출 사고는 발생하지 않는다.**
- **CP2 후속**: AI 준비도 게이팅이 필요해지면 레슨 상태를 되살리지 말고 **라이브 시작 전제**에
  얹는다 — preflight readiness가 이미 그 역할을 한다.
