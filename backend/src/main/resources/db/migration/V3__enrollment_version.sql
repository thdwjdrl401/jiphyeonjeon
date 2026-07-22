-- enrollment 낙관적 잠금(@Version) 컬럼. 동시 상태전이(강사 approve vs 학생 cancel 등)의
-- lost-update를 막는다 — 지는 트랜잭션은 낙관적 잠금 실패 → 409(CONCURRENT_MODIFICATION).
ALTER TABLE core.enrollment
  ADD COLUMN version bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN core.enrollment.version IS '낙관적 잠금 버전(@Version). 동시 상태전이 lost-update 방지.';
