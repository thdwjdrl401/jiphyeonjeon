-- 팬아웃 커서용 인덱스(ADR-0073 §5).
--
-- 넓은 팬아웃은 수신자 명단을 앱으로 끌어오지 않고, 조건으로 걸러진 집합 안에서 커서로 잘라 간다.
--
--   WHERE curriculum_id = ? AND status = 'ACTIVE' AND user_id > ?
--   ORDER BY user_id LIMIT 1000
--
-- 기존 인덱스는 (curriculum_id, status)까지라 **user_id 정렬을 인덱스가 해결하지 못한다** —
-- 조건에 맞는 행을 전부 읽어 정렬한 뒤 1,000개를 버리고 남긴다. 수강생이 많아질수록 조각을
-- 넘길 때마다 그 정렬을 처음부터 다시 한다.
--
-- user_id를 뒤에 붙이면 커서 조건과 정렬이 한 번의 인덱스 범위 스캔이 된다. 커서가 유일하고
-- 변하지 않는 값이어야 건너뜀이 생기지 않는데, user_id가 그 조건을 만족한다.
CREATE INDEX ix_enrollment_curriculum_status_user
    ON core.enrollment (curriculum_id, status, user_id);
