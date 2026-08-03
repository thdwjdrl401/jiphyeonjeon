-- 아웃박스에 목적지를 싣는다(ADR-0073 §4).
--
-- 지금까지 릴레이는 목적지를 코드에 박아 두고 모든 이벤트를 ingestion.embed로 보냈다. 아웃박스
-- 표 자체는 원래 범용인데(aggregate_type·event_type·payload_json) 릴레이 한 줄만 AI 전용으로
-- 굳어 있었다. 알림 팬아웃이 같은 경로를 쓰려면 목적지가 데이터여야 한다.

ALTER TABLE core.outbox_events
    ADD COLUMN destination text NOT NULL DEFAULT 'ingestion.embed';

-- 기본값은 **기존 행을 채우기 위한 것뿐**이다. 남겨 두면 목적지를 빠뜨린 새 코드가 조용히 AI 큐로
-- 가고, 그건 잘못된 워커가 알림 메시지를 받는다는 뜻이다. 채웠으니 걷어낸다 — 이제 목적지 없이
-- 넣으면 NOT NULL 위반으로 즉시 터진다.
ALTER TABLE core.outbox_events
    ALTER COLUMN destination DROP DEFAULT;

-- 릴레이가 **목적지별로** 100건씩 뽑는다. 한 인덱스로 목적지를 고르고 오래된 순서를 그대로 얻기
-- 위해 (destination, next_attempt_at, created_at) 순서다. PENDING만 담는 부분 인덱스인 이유는
-- 발행이 끝난 행이 계속 쌓여도 인덱스가 커지지 않게 하기 위해서다.
CREATE INDEX idx_outbox_pending_by_destination
    ON core.outbox_events (destination, next_attempt_at, created_at)
    WHERE status = 'PENDING';
