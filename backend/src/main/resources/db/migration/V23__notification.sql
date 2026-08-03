-- 알림 한 건. **수신자별로 한 행**이다(fan-out on write, ADR-0073).
--
-- 사건 하나가 여러 명에게 퍼질 때 발행 시점에 수신자 수만큼 행을 만든다. 반대 방식(사건 1행 +
-- 읽을 때 계산)을 쓰지 않는 이유는 action_status 때문이다 — 읽음은 시각 커서로 압축할 수 있지만
-- "승인함/아직/만료"는 사람마다 제각각이고 사용자가 읽어서가 아니라 서버가 바꾼다. 담을 자리가
-- 사건별·사람별로 하나씩 필요하다.
CREATE TABLE core.notification (
  id uuid PRIMARY KEY,
  recipient_id uuid NOT NULL,

  -- 계약이 정한 12개 고정 union(§2-4). 임의 문자열을 넣지 않는다.
  type varchar(32) NOT NULL,

  /*
   * 두 축을 합치지 않는다. read_status는 "봤는가", action_status는 "처리했는가"다.
   * 읽음 처리는 action_status를 **절대** 건드리지 않는다 — 강사가 수강 신청 알림을 읽어도
   * 승인·거절 전까지 할 일로 남아야 하고, 합치면 "처리 대기" 목록이 성립하지 않는다.
   */
  read_status varchar(8) NOT NULL DEFAULT 'UNREAD'
      CHECK (read_status IN ('UNREAD', 'READ')),
  action_status varchar(16) NOT NULL DEFAULT 'INFO'
      CHECK (action_status IN ('INFO', 'ACTION_REQUIRED', 'COMPLETED', 'EXPIRED')),

  -- 목록에서 칩 색을 가른다. 기준은 "지나면 늦는가" — 실패는 ERROR, 라이브 시각에 걸린 것은 HIGH.
  severity varchar(8) NOT NULL DEFAULT 'NORMAL'
      CHECK (severity IN ('NORMAL', 'HIGH', 'ERROR')),

  /*
   * 문구는 **만들 때 완성해 저장한다.** 알림은 "지금 상태"가 아니라 그때 일어난 일의 기록이라
   * 커리큘럼 이름이 바뀌어도 그때 이름으로 남는 편이 맞고, 목록 조회가 단일 테이블 읽기가 된다
   * (화면이 60초마다 개수를 물어본다).
   */
  title text NOT NULL,
  message text NOT NULL,

  -- 가리키는 리소스들. **프론트 라우트 URL을 담지 않는다** — 경로가 바뀌면 쌓인 알림이 전부 깨진다.
  -- 목적지는 type + 이 id들 + 클릭 시점의 리소스 상태로 화면이 계산한다.
  targets jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- 나중에 "수강 신청 3건"처럼 묶어 보이기 위한 키. 뒤늦게 붙이면 이미 쌓인 알림은 묶을 수 없다.
  group_key varchar(200) NOT NULL,

  /*
   * 같은 사건이 두 번 들어와도 한 건만 남기는 지문. **응답에 노출하지 않는다**(내부 값).
   *
   * 중복 방지를 애플리케이션에 맡기지 않는다 — Egress webhook 재전송처럼 동시에 두 번 들어오는
   * 경우를 코드로는 막을 수 없다. 넣는 쪽은 ON CONFLICT DO NOTHING을 쓴다. "넣어 보고 중복 예외를
   * 잡는" 방식은 못 쓴다 — 실패한 statement가 트랜잭션을 롤백 전용으로 만들어 예외를 잡아도
   * 커밋에서 다시 터진다.
   *
   * 구성은 {type}:{recipientId}:{리소스}. 반복되는 사건(일정 변경)은 리소스 부분에 새 시각을 넣어
   * 두 번째 변경이 첫 번째에 묻히지 않게 한다.
   */
  dedupe_key varchar(300) NOT NULL,

  -- 일정 변경 알림의 변경 전·후. "언제에서 언제로"가 없으면 그 알림은 쓸모가 없다.
  previous_starts_at timestamptz,
  next_starts_at timestamptz,

  /*
   * clock_timestamp()다. now()는 **트랜잭션 시작 시각**이라 한 트랜잭션에서 만든 알림이 전부 같은
   * 값을 갖고, 그러면 최신순 정렬이 무의미해진다(팬아웃 한 묶음은 같아도 되지만 서로 다른 사건이
   * 같은 트랜잭션에 들어올 때가 문제다).
   */
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz,
  completed_at timestamptz
);

-- 같은 사건은 한 건만. 애플리케이션이 아니라 DB가 보장한다.
CREATE UNIQUE INDEX uq_notification_dedupe ON core.notification (dedupe_key);

-- 조회는 언제나 "내 것을 최신순으로"다. 정렬까지 인덱스가 해결한다.
CREATE INDEX idx_notification_recipient ON core.notification (recipient_id, created_at DESC);

/*
 * 배지 개수 전용. 화면이 **60초마다** 미읽음·처리대기 수를 물어보므로 전체를 훑으면 안 된다.
 * 부분 인덱스라 읽었거나 처리한 알림은 인덱스에서 빠진다 — 알림이 아무리 쌓여도 세어야 하는 쪽만
 * 남는다. 두 개수를 한 문장에 FILTER로 묶으면 이 인덱스를 못 쓰므로 각각 센다.
 */
CREATE INDEX idx_notification_unread ON core.notification (recipient_id)
    WHERE read_status = 'UNREAD';
CREATE INDEX idx_notification_action_required ON core.notification (recipient_id)
    WHERE action_status = 'ACTION_REQUIRED';

COMMENT ON TABLE core.notification IS
  '알림 한 건(수신자별 1행). 읽음 축과 처리 축을 따로 둔다. dedupe_key로 같은 사건의 중복을 막는다.';
