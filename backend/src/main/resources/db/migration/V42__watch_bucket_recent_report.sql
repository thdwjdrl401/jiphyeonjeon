-- 운영 콘솔의 "지금 이 강의를 보고 있는 사람". 레슨 하나를 최근 시각 범위로 훑는다.
--
-- **왜 기존 인덱스로 안 되는가**: idx_watch_bucket_lesson은 (lesson_id, bucket_index)라 두 번째 키가
-- 칸 번호다. "이 레슨에서 최근 1분 안에 보고된 행"을 찾으려면 그 레슨의 칸을 전부 읽고 버려야 한다 —
-- 오래된 강의일수록 칸이 쌓여 있어, 사람이 아무도 안 보고 있을 때 가장 많이 읽는다.
--
-- **왜 updated_at인가**: 이 컬럼은 클라이언트가 시청을 보고할 때만, 그것도 now()(서버 시각)로
-- 갱신된다. learning_progress.updated_at은 진도 환산 배치(ADR-0117)가 레슨의 모든 시청자 행을
-- 한꺼번에 건드려서 "지금 보는 중"의 근거가 될 수 없다.
CREATE INDEX idx_watch_bucket_lesson_recent
  ON core.watch_bucket (lesson_id, updated_at DESC);

COMMENT ON INDEX core.idx_watch_bucket_lesson_recent IS
  '최근 시청 보고 조회(운영 콘솔의 현재 시청자). 레슨별 updated_at 역순 탐색.';
