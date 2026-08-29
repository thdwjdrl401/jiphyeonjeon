-- 항목 3의 두 삽입 방식을 계획으로 나란히 본다. 순진한 구조는 수신자 한 명에 한 문장,
-- 지금 구조는 한 문장이 조각 5,000명을 조회·삽입·중복 제거까지 한다.
--
-- 처리량 측정(bench/run-serial.sh)이 "몇 건/s"를 말한다면 이쪽은 "그 시간이 어디로 갔나"를
-- 말한다. 두 값이 서로를 확인한다.
--
-- **BEGIN/ROLLBACK 안에서 돈다.** EXPLAIN ANALYZE 는 실제로 실행하므로 감싸지 않으면
-- 벤치 데이터에 알림 5,001건이 남는다.
--
-- 사용법 (측정 머신에서)
--   docker compose -f bench/compose.bench.yml exec -T -e PGPASSWORD=bench postgres \
--       psql -U liveclass -d liveclass -e -f - < bench/explain.sql
--
-- -e 는 문장을 결과 앞에 찍는다. 캡처 한 장에 무엇을 물었는지가 같이 남는다.

BEGIN;

-- 두 삽입이 같은 문구를 가리키게 한 벌 넣어 둔다. 끝에서 ROLLBACK 하므로 남지 않는다.
INSERT INTO core.notification_content (id, type, severity, title, message, targets, group_key)
VALUES ('11111111-1111-4111-8111-111111111111', 'MATERIAL_PUBLISHED', 'NORMAL',
        '자료가 올라왔습니다', 'x.pptx', '{}'::jsonb, 'explain:bench');

-- ① 순진한 구조. 수신자 한 명에 한 문장. 이것을 100만 번 보낸다.
EXPLAIN (ANALYZE, BUFFERS)
INSERT INTO core.notification (id, recipient_id, content_id, dedupe_hash, read_status, action_status)
VALUES (gen_random_uuid(), '000009c2-4ec1-4422-b591-d7d69ca94c85',
        '11111111-1111-4111-8111-111111111111', md5('explain:one')::uuid, 'UNREAD', 'INFO');

-- ② 지금 구조. 한 문장이 조각 5,000명을 조회·삽입·중복 제거까지 한다.
EXPLAIN (ANALYZE, BUFFERS)
WITH slice AS (
    SELECT e.user_id
    FROM core.enrollment e
    WHERE e.curriculum_id = '00000000-0000-4000-8000-000000000002'
      AND e.status = 'ACTIVE'
    ORDER BY e.user_id
    LIMIT 5000
), inserted AS (
    INSERT INTO core.notification
            (id, recipient_id, content_id, dedupe_hash, read_status, action_status)
    SELECT gen_random_uuid(), s.user_id, '11111111-1111-4111-8111-111111111111',
           md5('explain:slice' || s.user_id)::uuid, 'UNREAD', 'INFO'
    FROM slice s
    ON CONFLICT (dedupe_hash) WHERE dedupe_hash IS NOT NULL DO NOTHING
    RETURNING recipient_id
)
SELECT (SELECT count(*) FROM slice)    AS scanned,
       (SELECT count(*) FROM inserted) AS inserted,
       (SELECT array_agg(recipient_id) FROM inserted) AS inserted_recipients,
       (SELECT s.user_id FROM slice s ORDER BY s.user_id DESC LIMIT 1) AS last_user_id;

ROLLBACK;
