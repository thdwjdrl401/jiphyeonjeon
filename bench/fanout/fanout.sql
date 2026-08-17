-- 팬아웃 조각 삽입 시간 측정.
--
-- **왜 이 값이 중요한가.** 조각 체인이 직렬이다 — 조각 N을 커밋해야 조각 N+1이 발행된다
-- (NotificationFanoutWorker.java:366). 그래서 워커를 늘려도 한 사건의 팬아웃은 안 빨라지고,
-- 조각당 시간 × 조각 수가 60초 예산에서 그대로 빠진다.
--
-- SQL은 NotificationFanoutRepository.INSERT_SLICE 그대로다. 한 글자도 바꾸지 않는다 —
-- 바꾸면 운영이 아니라 벤치를 재게 된다.
--
-- **프로시저에 COMMIT을 둔다.** 함수로 만들면 전체가 한 트랜잭션이라 조각마다의 커밋 비용
-- (WAL flush)이 빠진다. 운영은 조각마다 커밋하므로 그 비용을 포함해야 한다.
--
-- 이 측정이 제외하는 것: 앱↔DB 왕복, RabbitMQ 왕복, 워커 오버헤드.
-- 따라서 결과는 **하한**이다. 이 하한이 예산을 넘으면 그것만으로 결론이 난다.

\set ON_ERROR_STOP on

DROP TABLE IF EXISTS bench_fanout_result;
CREATE TABLE bench_fanout_result (
  slice_no    int,
  cursor_at   uuid,
  scanned     int,
  inserted    int,
  elapsed_ms  numeric(10,3)
);

CREATE OR REPLACE PROCEDURE bench_fanout(p_slice_limit int, p_max_slices int)
LANGUAGE plpgsql AS $proc$
DECLARE
  v_curriculum uuid := '00000000-0000-4000-8000-000000000002';
  -- content id는 운영에서 dedupe 접두사로부터 결정적으로 파생된다(UUID v3).
  -- 그 파생 로직이 측정 대상은 아니므로 고정값을 쓴다. 조각들이 같은 값을 공유하는
  -- 것이 중요하고, 그건 여기서도 같다.
  v_content    uuid := '3fa8b1c2-0000-3000-8000-000000000001';
  v_prefix     text := 'MATERIAL_PUBLISHED:00000000-0000-4000-8000-000000000009:';
  v_cursor     uuid := NULL;
  v_last       uuid;
  v_scanned    int;
  v_inserted   int;
  v_started    timestamptz;
  v_elapsed    numeric;
  i            int := 0;
BEGIN
  LOOP
    i := i + 1;
    EXIT WHEN i > p_max_slices;

    -- clock_timestamp()다. now()는 **트랜잭션 시작 시각**이라 루프 안에서 안 움직인다
    -- (NOTIFICATION-CENTER.md §5-1에 실제로 밟았던 자리로 기록돼 있다).
    v_started := clock_timestamp();

    WITH slice AS (
        SELECT e.user_id
        FROM core.enrollment e
        WHERE e.curriculum_id = v_curriculum
          AND e.status = 'ACTIVE'
          AND (v_cursor IS NULL OR e.user_id > v_cursor)
        ORDER BY e.user_id
        LIMIT p_slice_limit
    ), content AS (
        INSERT INTO core.notification_content (
            id, type, severity, title, message, targets, group_key,
            previous_starts_at, next_starts_at)
        SELECT v_content, 'MATERIAL_PUBLISHED', 'NORMAL', '새 강의 자료',
               '«벤치 커리큘럼»에 새 자료 «3주차.pptx»가 올라왔습니다.',
               '{"curriculumId":"00000000-0000-4000-8000-000000000002"}'::jsonb,
               'MATERIAL_PUBLISHED:00000000-0000-4000-8000-000000000002',
               NULL, NULL
        WHERE EXISTS (SELECT 1 FROM slice)
        ON CONFLICT (id) DO NOTHING
    ), candidate AS (
        SELECT s.user_id, md5(v_prefix || s.user_id)::uuid AS dedupe_hash
        FROM slice s
    ), passed AS (
        INSERT INTO core.notification_dedupe (dedupe_hash)
        SELECT c.dedupe_hash FROM candidate c
        ON CONFLICT (dedupe_hash) DO NOTHING
        RETURNING dedupe_hash
    ), inserted AS (
        INSERT INTO core.notification (id, recipient_id, content_id, read_status, action_status)
        SELECT gen_random_uuid(), c.user_id, v_content, 'UNREAD', 'INFO'
        FROM candidate c
        JOIN passed p ON p.dedupe_hash = c.dedupe_hash
        RETURNING recipient_id
    )
    SELECT (SELECT count(*) FROM slice),
           (SELECT count(*) FROM inserted),
           (SELECT s.user_id FROM slice s ORDER BY s.user_id DESC LIMIT 1)
      INTO v_scanned, v_inserted, v_last;

    v_elapsed := EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000;

    INSERT INTO bench_fanout_result (slice_no, cursor_at, scanned, inserted, elapsed_ms)
    VALUES (i, v_cursor, v_scanned, v_inserted, v_elapsed);

    -- 운영은 조각마다 커밋한다. 그 비용(WAL flush)을 측정에 포함한다.
    COMMIT;

    -- 운영의 종료 판정과 같다 — inserted가 아니라 scanned를 본다.
    EXIT WHEN v_scanned < p_slice_limit OR v_last IS NULL;
    v_cursor := v_last;
  END LOOP;
END $proc$;
