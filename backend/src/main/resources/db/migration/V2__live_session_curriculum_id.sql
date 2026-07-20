-- 수강 기반 접근 게이팅용: live_session에 소속 커리큘럼을 비정규화한다.
-- live가 session→curriculum을 직접 알아 enrollment.isActive를 사이클(live→curriculum) 없이 확인한다.
ALTER TABLE core.live_session ADD COLUMN curriculum_id uuid REFERENCES core.curriculum(id);

-- 기존 세션 백필: lesson→section→curriculum.
UPDATE core.live_session ls
SET curriculum_id = s.curriculum_id
FROM core.lesson l
JOIN core.section s ON l.section_id = s.id
WHERE l.id = ls.lesson_id;

ALTER TABLE core.live_session ALTER COLUMN curriculum_id SET NOT NULL;

COMMENT ON COLUMN core.live_session.curriculum_id IS '소속 커리큘럼(비정규화). 수강 기반 접근 게이팅용 — session→enrollment.isActive를 사이클 없이.';
