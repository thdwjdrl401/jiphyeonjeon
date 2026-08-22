-- 푸시 발송 진행 표(ADR-0124). "이 사건의 이 사람에 대한 발송 시도를 마쳤다"의 기록이다.
--
-- 왜 필요한가: 푸시 명령의 재시도 단위는 큐 메시지(조각)인데 실패 단위는 사람·기기다. 알림 행의
-- dedupe는 "폰이 두 번 울림"을 막으면서 "누가 못 받았는지"의 기록까지 지운다 — 재배달된 조각은
-- 삽입 0건으로 수신자 명단이 비어서 돌아오고, 그러면 못 받은 사람도 영영 못 받는다. 그래서
-- "발송을 마쳤다"를 알림 행과 별개로 적어 두고, 재배달은 이 표와의 anti-join으로 **아직 안 보낸
-- 사람만** 다시 집는다.
--
-- UNLOGGED인 이유: 이 표는 성능 장치이지 진실의 원천이 아니다. 알림 자체는 core.notification에
-- 있고, DB가 크래시해 이 표가 truncate되면 그 시점에 배달 중이던 방송을 처음부터 다시 보낼
-- 뿐이다 — 일부가 두 번 울린다. "조용한 유실"보다 "가끔 두 번"을 고른 것이다(ADR-0124).
-- WAL을 쓰지 않으므로 팬아웃 속도로 쌓여도 쓰기 비용이 낮다.
--
-- 일 파티션인 이유: 행은 발송 뒤 며칠이면 쓸모가 없는데(재배달 창은 길어야 시간 단위) DELETE로
-- 지우면 vacuum이 따라와야 한다. 파티션 DROP은 지우기가 공짜다. 선생성·DROP·DEFAULT 파티션 점검은
-- PushProgressPartitionJob이 맡는다.
--
-- PG16에서 UNLOGGED는 파티션에 **상속되지 않는다**(부모는 저장소가 없어 선언이 장식일 뿐이다 —
-- pgvector/pg16에서 확인). 그래서 파티션을 만들 때마다 UNLOGGED를 명시해야 한다. 아래 DO 블록과
-- 파티션 잡 양쪽 모두 그렇게 한다.
CREATE UNLOGGED TABLE core.notification_push_progress (
  -- 사건 식별자. 워커가 알림 dedupe 키(넓은 팬아웃은 수신자를 붙이기 전의 접두)를 md5(uuid v3)로
  -- 접은 값이다. 다른 목적의 dedupe 등록표와는 별개다 — 이 표는 오직 푸시 발송 진행만 담는다.
  event_hash uuid NOT NULL,
  recipient_id uuid NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (settled_at);

COMMENT ON TABLE core.notification_push_progress IS
  '푸시 발송 진행(ADR-0124). 행이 있으면 그 사건의 그 사람에 대한 발송 시도가 끝난 것이다. '
  'UNLOGGED — 크래시 시 사라지면 재발송으로 이어질 뿐, 유실은 없다.';

/*
 * 전역 유니크는 걸 수 없다 — 파티션 표의 유니크는 파티션 키(settled_at)를 포함해야 하는데,
 * 그 키가 들어가면 "같은 사건·같은 사람" 중복을 막지 못한다. 그래서 파티션마다 지역 유니크
 * (event_hash, recipient_id)만 건다. 날짜를 넘긴 중복 행(어제 기록했는데 재배달로 오늘 또 기록)은
 * 이론상 가능하지만 anti-join은 "있는가"만 보므로 의미상 무해하고, 재배달 창(분 단위)이 파티션
 * 폭(하루)보다 훨씬 짧아 실제로도 드물다. 이 인덱스의 진짜 일은 anti-join 탐색이다.
 */

-- DEFAULT 파티션이 받아 둔다. 잡이 오래 죽어 그 날짜의 파티션이 없어도 INSERT가 실패하지 않고
-- 여기로 떨어진다. 행이 잡히면 잡이 WARN으로 알린다 — 파티션 선생성이 밀렸다는 신호다.
CREATE UNLOGGED TABLE core.notification_push_progress_default
  PARTITION OF core.notification_push_progress DEFAULT;

CREATE UNIQUE INDEX notification_push_progress_default_key
  ON core.notification_push_progress_default (event_hash, recipient_id);

-- 첫 15일치(오늘 포함)를 마이그레이션에서 미리 만든다. 잡의 첫 주기를 기다리는 사이에 온 푸시가
-- DEFAULT로 떨어지면, 그 범위의 파티션 생성이 (DEFAULT에 행이 있어) 실패해 WARN이 반복된다 —
-- 그 창을 처음부터 닫아 둔다. 경계는 UTC 자정으로 고정한다(잡과 같은 기준이어야 이름이 겹친다).
DO $$
DECLARE
  d date;
  part text;
BEGIN
  FOR i IN 0..14 LOOP
    d := (now() AT TIME ZONE 'UTC')::date + i;
    part := 'notification_push_progress_p' || to_char(d, 'YYYYMMDD');
    EXECUTE format(
      'CREATE UNLOGGED TABLE IF NOT EXISTS core.%I PARTITION OF core.notification_push_progress '
        || 'FOR VALUES FROM (%L) TO (%L)',
      part, d::text || ' 00:00:00+00', (d + 1)::text || ' 00:00:00+00');
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON core.%I (event_hash, recipient_id)',
      part || '_key', part);
  END LOOP;
END $$;
