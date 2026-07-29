-- 커리큘럼-레벨 강의 자료(ADR-0042). 레슨 자료(ADR-0035)와 같은 material_asset 테이블을 재사용하되,
-- 소속을 레슨 또는 커리큘럼 중 하나로 확장한다. 레슨 자료는 강의 하나에, 커리큘럼 자료는 커리큘럼
-- 전체(모든 강의 공통)에 붙는다. AI 콜백은 materialId, 다운로드 URL은 assetId로만 키를 잡아
-- 스코프와 무관하게 그대로 동작한다 — 그래서 새 테이블 대신 확장으로 최대 재사용한다.

-- 1) lesson_id를 nullable로 — 커리큘럼 자료는 레슨이 없다. (V1의 NOT NULL 해제)
ALTER TABLE core.material_asset ALTER COLUMN lesson_id DROP NOT NULL;

-- 2) curriculum_id 추가(커리큘럼 스코프). 커리큘럼 삭제 시 자료 레코드도 함께 정리.
ALTER TABLE core.material_asset
  ADD COLUMN curriculum_id uuid NULL REFERENCES core.curriculum(id) ON DELETE CASCADE;

-- 3) 스코프는 정확히 하나 — 레슨 자료(lesson_id)이거나 커리큘럼 자료(curriculum_id)이거나. 둘 다/둘 다 없음은 금지.
ALTER TABLE core.material_asset
  ADD CONSTRAINT ck_material_scope CHECK ((lesson_id IS NOT NULL) <> (curriculum_id IS NOT NULL));

-- 4) 커리큘럼 자료의 동시 중복 연결을 DB에서 막는다(레슨의 uq_material_active와 대칭, ADR-0035 §동시성).
--    부분 유니크라 소프트 삭제(DELETED) 후 같은 자료 재연결은 허용.
CREATE UNIQUE INDEX uq_curriculum_material_active
  ON core.material_asset (curriculum_id, asset_id) WHERE status = 'ACTIVE';

-- 5) 커리큘럼 상세·관리 화면의 자료 목록 조회용 인덱스(레슨의 ix_material_lesson와 대칭).
CREATE INDEX ix_material_curriculum ON core.material_asset (curriculum_id);

COMMENT ON COLUMN core.material_asset.curriculum_id IS
  '커리큘럼-레벨 자료가 속한 커리큘럼(ADR-0042). lesson_id와 상호배타(ck_material_scope). 레슨 자료면 NULL.';
COMMENT ON COLUMN core.material_asset.lesson_id IS
  '레슨-레벨 자료가 속한 레슨(ADR-0035). curriculum_id와 상호배타. 커리큘럼 자료면 NULL.';
