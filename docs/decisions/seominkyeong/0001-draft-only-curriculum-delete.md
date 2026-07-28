# ADR-0001: 커리큘럼 삭제는 초안(DRAFT)만 허용한다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-07-28
- **관련**: Sub Ⅱ, 브랜치 `fix/fe/authoring-ux`, 관련 ADR: [songjeongki/0041-instructor-authoring-reads-and-autosave.md](../songjeongki/0041-instructor-authoring-reads-and-autosave.md)

## 맥락 (Context)

강사가 '내 커리큘럼'에서 잘못 만든 초안을 지울 방법이 없었다. 기존 lifecycle 커맨드는
발행(`publish`)·보관(`archive`) 뿐이고, 삭제는 [songjeongki/0021](../songjeongki/0021-lesson-publish-mvp-direct.md)
계열 논의에서 "정책 미확정"으로 미뤄져 있었다. 화면에는 지울 수 없는 초안이 계속 쌓인다.

제약이 둘 있다.

1. DB는 `curriculum`을 정점으로 `section → lesson → material·live_session`까지
   `ON DELETE CASCADE`로 묶여 있다(`V1__init_core.sql`). 커리큘럼 한 행을 지우면 하위가 전부 사라진다.
2. 한 번이라도 공개된 커리큘럼에는 수강 이력(`enrollment`)이 붙을 수 있다. 이것까지 캐스케이드로
   지우면 학생 쪽 기록이 예고 없이 증발한다.

## 결정 (Decision)

`DELETE /api/instructor/curriculums/{curriculumId}`를 추가하되 **`lifecycleStatus`가 `DRAFT`일 때만**
허용한다. `PUBLISHED`·`ARCHIVED`는 `409 CURRICULUM_STATE_CONFLICT`로 거절하고 보관(archive)으로 유도한다.
성공은 `204 No Content`, 타인 소유는 `403 CURRICULUM_FORBIDDEN`, 없으면 `404 CURRICULUM_NOT_FOUND`다.

FE는 '내 커리큘럼' 카드에서 `lifecycleStatus === 'DRAFT'`인 항목에만 삭제 버튼을 노출한다.

## 근거 (Rationale)

- **초안은 아직 아무의 것도 아니다.** DRAFT는 카탈로그에 뜨지 않아(`CatalogService`는 PUBLISHED만 조회)
  수강 신청이 존재할 수 없다. 캐스케이드가 지우는 범위가 전부 작성자 본인의 미공개 산출물이다.
- **공개 이력은 지우지 않는다.** 이미 공개된 것을 되돌리는 수단은 이미 `archive`가 있다. 삭제와 보관의
  역할을 갈라 두면 "실수로 학생 기록까지 날리는" 경로 자체가 생기지 않는다.
- **상태 판정을 서버에 둔다.** FE가 버튼을 감추는 것은 편의일 뿐이고, 실제 방어는 서버의 상태 검사다.
  publish/archive가 이미 쓰는 `CurriculumStateConflictException` → 409 매핑을 그대로 재사용한다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| **(선택) DRAFT만 하드 삭제** | 캐스케이드 범위가 작성자 본인 미공개 데이터로 한정됨. 기존 409 매핑 재사용 | 공개 후엔 삭제 불가 — 보관으로만 내릴 수 있음 |
| 모든 상태 하드 삭제 | 화면이 단순 | 수강 이력까지 캐스케이드로 소실. 되돌릴 수 없음 |
| soft delete(`deleted_at`) | 복구 가능 | 카탈로그·목록·집계 쿼리 전부에 필터 추가 필요. 지금 필요한 범위에 비해 과함 |

## 영향·후속 (Consequences)

- **계약 자물쇠 채택**: 상태코드(204/409/403/404)에 FE 분기가 걸리므로 [POLICY](../../harness/POLICY.md)
  기준 "상태코드·응답 규격" 항목에 해당 → 계약 테스트 필수.
  `backend/src/test/java/com/liveclass/curriculum/CurriculumDeleteContractTest.java` (6 케이스, 섹션 캐스케이드 포함).
  FE는 호출 경로를 `frontend/src/test/features/curriculum/curriculumStructureDelete.test.ts`로 고정.
- **카운터 트리거**: `trg_section_count`가 이미 사라진 부모 행을 `UPDATE`하려 하지만 0건으로 무시된다
  (Postgres는 부모 행을 먼저 지우고 캐스케이드 트리거를 뒤에 돌린다). 별도 처리 없음 — 계약 테스트의
  `deleting_a_draft_also_removes_its_sections`가 이 경로를 지난다.
- **소프트 삭제로 갈 경우** 이 ADR을 대체하고 카탈로그·목록·대시보드 집계 쿼리에 필터를 추가해야 한다.
- **문서**: [CONTRACT.md](../../CONTRACT.md) 강사 커리큘럼 절에 삭제 엔드포인트를 반영한다.
