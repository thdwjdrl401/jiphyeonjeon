-- core.notification을 월 단위 RANGE 파티션으로 재생성한다(ADR-0123).
--
-- 알림은 순수 append 표다 — 갱신은 read/action 축 두 칸뿐이고 오래된 행은 다시 읽히지 않는다.
-- 보존 정책이 "오래된 것 삭제"가 되는 순간 DELETE는 답이 아니다: 수백만 행 DELETE는 시간이
-- 걸리고 죽은 튜플·인덱스 팽창을 남긴다. 파티션 DROP은 파일을 지우는 것이라 몇 ms로 끝난다.
--
-- 파티션 키는 created_at. PK가 키를 포함해야 하므로 (id, created_at)이 된다. 기존 조회
-- (WHERE id=? AND recipient_id=?)에는 created_at 조건이 없어 전 파티션의 PK 인덱스를 하나씩
-- 찔러 보게 되는데, 보존 12개월 + 선생성 3개월 = 수십 개 수준이라 감수한다(ADR-0123 §한계).
--
-- 문구 컬럼(title·message·targets·group_key·severity·type·시각 두 칸)은 V43이 뽑아낸
-- core.notification_content로 갔고, dedupe_key는 V44의 전역 등록표로 갔다. 남는 것은
-- 수신자별로 정말 다른 값들뿐이다 — 행이 ~557B에서 ~90B로 준다.
CREATE TABLE core.notification_partitioned (
  id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  -- 사건 문구. 좁은 팬아웃(사람 이름이 든 문구)은 수신자당 content 1행일 수 있다 — 그래도
  -- 경로는 한 벌이다. FK 덕에 content를 먼저 지울 수 없다(파티션 DROP 후 고아 content가 남는
  -- 것은 ADR-0123 §한계).
  content_id uuid NOT NULL REFERENCES core.notification_content (id),

  -- 두 축을 합치지 않는다(V23과 동일). 읽음 처리는 처리 축을 절대 건드리지 않는다.
  read_status varchar(8) NOT NULL DEFAULT 'UNREAD'
      CHECK (read_status IN ('UNREAD', 'READ')),
  action_status varchar(16) NOT NULL DEFAULT 'INFO'
      CHECK (action_status IN ('INFO', 'ACTION_REQUIRED', 'COMPLETED', 'EXPIRED')),

  -- clock_timestamp()다. now()는 트랜잭션 시작 시각이라 최신순 정렬이 무의미해진다(V23 주석).
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz,
  completed_at timestamptz,

  -- 이름이 임시인 이유: 옛 표가 아직 살아 있어 notification_pkey 인덱스 이름을 점유하고 있다.
  -- 아래 스왑 뒤에 제 이름으로 바꾼다.
  CONSTRAINT notification_partitioned_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

/*
 * 파티션 선생성: 기존 데이터의 첫 달부터 앞으로 3개월치까지. 경계는 서버 시간대(UTC) 기준의
 * 달 경계다 — 보존 DROP이 "몇 월분"을 지우는 단위이므로 사람이 읽는 달과 몇 시간 어긋나는
 * 것은 문제가 되지 않는다.
 *
 * fillfactor 90은 파티션마다 건다(파티션드 부모는 저장 파라미터를 갖지 못한다). 효과는
 * 정직하게: read/action 축 갱신은 부분 인덱스 술어에 걸린 컬럼이라 HOT이 안 되고, fillfactor는
 * 그 갱신이 일으키는 페이지 분할을 완화하는 정도다(ADR-0123 §D).
 */
DO $$
DECLARE
    month_start date;
    last_month date;
BEGIN
    SELECT date_trunc('month', coalesce(min(created_at), now()))::date
      INTO month_start
      FROM core.notification;
    last_month := (date_trunc('month', now()) + interval '3 months')::date;
    WHILE month_start <= last_month LOOP
        EXECUTE format(
            'CREATE TABLE core.%I PARTITION OF core.notification_partitioned '
                || 'FOR VALUES FROM (%L) TO (%L) WITH (fillfactor = 90)',
            'notification_p' || to_char(month_start, 'YYYY_MM'),
            month_start, (month_start + interval '1 month')::date);
        month_start := (month_start + interval '1 month')::date;
    END LOOP;
END $$;

-- 에어백. 선생성 잡이 어떤 이유로든 멈춰도 INSERT가 실패하는 대신 여기로 떨어진다. 잡이 매일
-- 이 파티션의 행 수를 보고 0이 아니면 WARN을 남긴다 — 조용히 쌓이면 "파티션이 안 만들어지고
-- 있다"를 아무도 모른다.
CREATE TABLE core.notification_default
    PARTITION OF core.notification_partitioned DEFAULT WITH (fillfactor = 90);

-- 기존 행 이사. 운영 데이터는 수천 행 규모라 한 트랜잭션 안의 INSERT SELECT로 충분하다.
INSERT INTO core.notification_partitioned
       (id, recipient_id, content_id, read_status, action_status, created_at, read_at, completed_at)
SELECT id, recipient_id, content_id, read_status, action_status, created_at, read_at, completed_at
FROM core.notification;

-- 스왑. 같은 트랜잭션이라 기동 중 어느 시점에도 core.notification이 없는 순간은 밖에서 보이지
-- 않는다(Flyway가 마이그레이션 하나를 한 트랜잭션으로 돈다).
DROP TABLE core.notification;
ALTER TABLE core.notification_partitioned RENAME TO notification;
ALTER INDEX core.notification_partitioned_pkey RENAME TO notification_pkey;

-- 인덱스는 V23과 같은 세 벌을 파티션드 인덱스로 유지한다(각 파티션에 자동 전파).
-- dedupe 유니크만 없다 — 그 역할은 V44의 등록표가 한다.
CREATE INDEX idx_notification_recipient ON core.notification (recipient_id, created_at DESC);
CREATE INDEX idx_notification_unread ON core.notification (recipient_id)
    WHERE read_status = 'UNREAD';
CREATE INDEX idx_notification_action_required ON core.notification (recipient_id)
    WHERE action_status = 'ACTION_REQUIRED';

COMMENT ON TABLE core.notification IS
  '알림 한 건(수신자별 1행, 월 파티션). 문구는 content_id → core.notification_content, 중복 제거는 '
  'core.notification_dedupe 등록표가 담당한다. 파티션은 잡이 선생성·보존 DROP한다(ADR-0123).';
