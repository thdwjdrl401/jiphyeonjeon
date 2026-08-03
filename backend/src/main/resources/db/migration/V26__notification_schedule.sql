-- 발화 예정 표(ADR-0073 §6). "언제 알릴지"만 담고 "누구에게"는 담지 않는다.
--
-- 알림 12종 가운데 LIVE_STARTING_SOON만 아무 사건 없이 시각이 되면 나가야 한다. 나머지는 승인·
-- 게시·완료처럼 그 순간 일어난 일이라 사건이 곧 트리거다.
--
-- **수신자를 미리 펼치지 않는다.** 예약 시점에 사람별 행을 만들면 그때의 명단이 굳어, 뒤에 수강한
-- 사람은 못 받고 취소한 사람은 받는다. 게다가 예약할 때 한 번, 발화할 때 한 번 팬아웃을 두 번
-- 하게 된다. 여기에는 세션당 리드타임 수만큼의 행만 있고, 수강생이 100만 명이어도 그대로다.
CREATE TABLE core.notification_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  live_session_id uuid NOT NULL,

  /*
   * 시작 몇 분 전인가. 3단계까지는 10분 고정이고, 4단계에서 선택지(5·10·30·60·180·1440)를 열 때
   * 세션당 행이 늘어난다. 자유 입력이 아니라 선택지인 이유는, 누가 47분으로 바꿀 때마다 그 세션에
   * 새 행을 만들어야 하고 설정 변경이 예정 표를 건드리게 되기 때문이다.
   */
  lead_minutes integer NOT NULL,

  /*
   * 라이브 시작 시각. fire_at에서 역산할 수 있지만 따로 둔다 — 발화가 한참 밀렸을 때
   * (배포·장애로 폴링이 멈춘 뒤) "이미 시작한 라이브"에 곧 시작 알림을 보내지 않으려면
   * 발화 시점에 이 값을 봐야 한다.
   */
  starts_at timestamptz NOT NULL,

  fire_at timestamptz NOT NULL,

  /** 한 번만 나가게 하는 자물쇠. 폴링이 겹쳐 돌아도 이 값이 채워진 행은 다시 뽑히지 않는다. */
  fired_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- 같은 세션·같은 리드타임은 하나뿐이다. 일정이 바뀌면 새 행이 아니라 이 행의 시각을 옮긴다.
  UNIQUE (live_session_id, lead_minutes)
);

-- 폴링은 "아직 안 나갔고 시각이 된 것"만 본다. 나간 행이 쌓여도 인덱스가 커지지 않게 부분 인덱스다.
CREATE INDEX idx_notification_schedule_due
    ON core.notification_schedule (fire_at)
    WHERE fired_at IS NULL;

COMMENT ON TABLE core.notification_schedule IS
  '라이브 곧 시작 알림의 발화 예정. 수신자는 담지 않는다 — 명단은 발화 시점의 수강 상태가 정한다.';
