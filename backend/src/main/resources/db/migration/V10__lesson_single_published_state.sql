-- 레슨에서 초안 상태를 없앤다(ADR-0005).
--
-- 공개 여부를 결정하는 축이 둘(커리큘럼 lifecycle_status, 레슨 status)이라 "게시 강의 5/5인데
-- 실제 공개 0"이라는 막다른 상태가 만들어졌다. 축을 커리큘럼 하나로 줄인다. 레슨은 만들어지는
-- 순간 PUBLISHED이며 되돌릴 상태가 없다. AI_NOT_READY·READY는 도달 경로가 없어 함께 정리한다.

-- 1) 남아 있는 비게시 레슨을 게시 상태로 승격한다.
--    비공개 커리큘럼의 초안 레슨이 이 마이그레이션으로 외부에 노출되지는 않는다 —
--    카탈로그는 커리큘럼 lifecycle_status='PUBLISHED'만 조회하기 때문이다.
UPDATE core.lesson
   SET status = 'PUBLISHED',
       published_at = COALESCE(published_at, now())
 WHERE status <> 'PUBLISHED';

-- 2) CHECK 제약을 한 값으로 좁힌다. 이후 DRAFT를 쓰려는 코드는 INSERT/UPDATE 시점에 즉시 실패한다.
ALTER TABLE core.lesson DROP CONSTRAINT IF EXISTS lesson_status_check;
ALTER TABLE core.lesson
  ADD CONSTRAINT lesson_status_check CHECK (status IN ('PUBLISHED'));

-- 3) 기본값도 맞춘다. 앱이 값을 채우지만, DDL만 보고 스키마를 읽는 사람에게 정본을 남긴다.
ALTER TABLE core.lesson ALTER COLUMN status SET DEFAULT 'PUBLISHED';

COMMENT ON COLUMN core.lesson.status IS
  '작성 생명주기. 값은 PUBLISHED 하나 — 레슨에는 초안이 없다(ADR-0005). 외부 공개 여부는 curriculum.lifecycle_status가 결정한다.';
COMMENT ON COLUMN core.lesson.published_at IS '레슨을 만든 시각(= 게시 시각). 레슨은 생성 즉시 게시된다.';

-- curriculum.published_lesson_count와 트리거(trg_lesson_count)는 그대로 둔다. 모든 레슨이
-- PUBLISHED가 되었으므로 값은 lesson_count와 같아지고, 카운터 자체는 여전히 정확하다.
-- 컬럼을 지우면 강사 목록 응답(publishedLessonCount)의 공유 계약이 깨지므로 건드리지 않는다.
COMMENT ON COLUMN core.curriculum.published_lesson_count IS
  '게시된 레슨 수(트리거 유지). 레슨이 생성 즉시 게시되므로 lesson_count와 같은 값이 된다.';
