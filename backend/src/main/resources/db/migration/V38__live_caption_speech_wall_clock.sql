-- 자막 세그먼트의 발화 벽시계(ADR-0107).
--
-- 기존 start/end_stream_elapsed_ms는 **받은 오디오의 누적 길이**라 무음이 빠진다. 그래서 세션 시계로
-- 옮길 수 없다(ADR-0106 — 그렇게 하려다 자막이 세션마다 0.6~21초 어긋났다). agent가 이제 발화가 실제로
-- 시작·종료한 UTC 시각을 함께 보내므로 그것을 그대로 보관한다.
--
-- nullable이다. 옛 행과, agent가 시각을 싣지 않은 경우가 있다 — 그때는 종전대로 근사 축으로 물러난다.
ALTER TABLE core.live_caption
    ADD COLUMN started_at timestamptz,
    ADD COLUMN ended_at   timestamptz;

COMMENT ON COLUMN core.live_caption.started_at IS
    '발화 시작 UTC 벽시계(caption.segment.final 전용, nullable). stream_elapsed_ms와 달리 무음을 포함한다.';
COMMENT ON COLUMN core.live_caption.ended_at IS
    '발화 종료 UTC 벽시계(caption.segment.final 전용, nullable).';
