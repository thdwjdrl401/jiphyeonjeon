--
-- 알림 표에서 월 파티셔닝을 걷고, 중복 제거 등록표를 알림 표 안으로 되돌린다 (ADR-0132).
--
-- V45가 파티션을 만든 근거는 하나였다 — 보존 정리를 DELETE가 아니라 파티션 DROP으로 하려는 것.
-- 그런데 알림은 시스템이 임의로 지우는 자료가 아니다. 보존 정리가 없으면 파티션이 하는 일이
-- 없고, 파티션 때문에 진 빚만 남는다.
--
--   전역 UNIQUE 불가   파티션 유니크 인덱스는 파티션 키를 포함해야 한다. 그래서 "사람 × 사건"
--                      중복 방지가 별도 표(V44)로 나갔다. 실측으로 알림 1건당 힙 1행과
--                      인덱스 1벌이 더 들었고, 팬아웃 DB 부하의 26%(88MB)가 그 자리였다.
--   목록 조회          알림함은 recipient_id로 찾지 달로 찾지 않는다. 파티션 키 조건이 없으니
--                      모든 파티션을 훑어 합쳐야 한다.
--   단건 조회          PK가 (id, created_at)이라 id만으로는 파티션을 못 고른다.
--   운영 잡            선생성·DROP·DEFAULT 파티션 점검이 계속 돌아야 한다.
--
-- 되돌리는 값은 명확하다. 나중에 보존 정리가 필요해지면 그때는 DELETE + VACUUM이고, 실측으로
-- 100만 행에 1.2초 + WAL 54MB이며 인덱스 139MB는 회수되지 않는다. 그 비용을 지금 치르지 않는
-- 것이 아니라, 지지 않기로 한 요구사항에 맞춰 구조를 되돌리는 것이다.

-- ── 1. 일반 테이블 ──
-- 컬럼은 V45와 같고 dedupe_hash 하나가 늘었다. PK에서 created_at이 빠진다.
CREATE TABLE core.notification_flat (
  id uuid PRIMARY KEY,
  recipient_id uuid NOT NULL,
  content_id uuid NOT NULL,

  -- V44의 등록표가 들고 있던 값. md5(dedupe_key)를 uuid로 접은 것이고 사람 × 사건마다 유일하다.
  -- 파티션이 없어졌으므로 이제 이 표에서 직접 막을 수 있다.
  --
  -- NULL을 허용하는 이유는 이관 때문이다. 옛 행의 해시는 복원할 수 없다 — 알림 표가 그 값을
  -- 저장한 적이 없고 등록표와 값으로 이어지지도 않는다. 옛 행은 NULL로 두고 새 행부터 채운다.
  -- 옛 사건이 다시 배달될 일은 없다. 그 아웃박스 행은 이미 PUBLISHED다.
  dedupe_hash uuid,

  read_status varchar(8) NOT NULL DEFAULT 'UNREAD'
      CHECK (read_status IN ('UNREAD', 'READ')),
  action_status varchar(16) NOT NULL DEFAULT 'INFO'
      CHECK (action_status IN ('INFO', 'ACTION_REQUIRED', 'COMPLETED', 'EXPIRED')),

  -- clock_timestamp()다. now()는 트랜잭션 시작 시각이라 최신순 정렬이 무의미해진다(V23 주석).
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz,
  completed_at timestamptz
) WITH (fillfactor = 90);

-- ── 2. 이관 ──
INSERT INTO core.notification_flat
    (id, recipient_id, content_id, dedupe_hash, read_status, action_status,
     created_at, read_at, completed_at)
SELECT id, recipient_id, content_id, NULL, read_status, action_status,
       created_at, read_at, completed_at
  FROM core.notification;

-- ── 3. 스왑 ──
-- CASCADE는 파티션들을 함께 지운다. 알림을 가리키는 외래 키는 없다(V47이 content 쪽을 끊었고,
-- 발송 진행 표는 값으로만 이어진다).
DROP TABLE core.notification CASCADE;
ALTER TABLE core.notification_flat RENAME TO notification;
ALTER TABLE core.notification RENAME CONSTRAINT notification_flat_pkey TO notification_pkey;

-- ── 4. 인덱스 ──
-- V45와 같은 세 벌. 이번에는 파티션드가 아니라 보통 인덱스다.
CREATE INDEX idx_notification_recipient ON core.notification (recipient_id, created_at DESC);
CREATE INDEX idx_notification_unread ON core.notification (recipient_id)
    WHERE read_status = 'UNREAD';
CREATE INDEX idx_notification_action_required ON core.notification (recipient_id)
    WHERE action_status = 'ACTION_REQUIRED';

-- 중복 방지. 부분 인덱스라 이관된 옛 행(NULL)은 서로 부딪히지 않는다.
CREATE UNIQUE INDEX notification_dedupe_uk ON core.notification (dedupe_hash)
    WHERE dedupe_hash IS NOT NULL;

-- ── 5. 등록표 제거 ──
DROP TABLE core.notification_dedupe;

COMMENT ON TABLE core.notification IS
  '수신자별 알림 한 행(fan-out on write). 문구는 core.notification_content가 사건당 1행으로 갖는다.
파티션하지 않는다 — 시스템이 알림을 지우지 않으므로 보존 정리가 없고, 파티션의 유일한 근거가
그것이었다(ADR-0132).';
COMMENT ON COLUMN core.notification.dedupe_hash IS
  '사람 × 사건 중복 방지. md5(dedupe_key)를 uuid로 접은 값. 넣는 쪽은 ON CONFLICT DO NOTHING으로
통과 여부를 판정한다. V48 이전에 만들어진 행은 NULL이다(ADR-0132).';
