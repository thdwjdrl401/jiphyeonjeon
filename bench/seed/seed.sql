-- 벤치용 대량 시드.
--
-- **앱을 통해 만들지 않는다.** 행마다 왕복하면 100만 건에 몇십 분이 걸리는데, 그 비용이
-- 정확히 이 벤치가 측정하려는 문제다. 시드가 그 방식을 쓰면 시드부터 몇 시간이 된다.
-- generate_series로 DB 안에서 만들면 수 초로 끝난다.
--
-- 멱등이다. 다시 돌리면 지우고 다시 만든다.
--
--   psql -v users=1000000 -v subs_ratio=1.2 -f seed.sql
--
-- 매개변수
--   users       수강생 수 (기본 1,000,000)
--   subs_ratio  수강생당 평균 푸시 구독 수 (기본 1.2)
--               분포: 10% 0대 · 70% 1대 · 20% 2대  →  평균 1.1
--               ratio를 올리면 2대 비율이 커진다.

\set ON_ERROR_STOP on
\if :{?users}      \else \set users 1000000 \endif
\if :{?subs_ratio} \else \set subs_ratio 1.2 \endif

\timing on

BEGIN;

-- ── 고정 식별자 ───────────────────────────────────────────────────────────
-- 벤치가 커리큘럼·레슨 id를 알아야 팬아웃을 트리거할 수 있다. 난수로 만들면 매번
-- 바뀌어 스크립트가 조회를 한 번 더 해야 하므로, 결정적 UUID로 못 박는다.
\set instructor_id '''00000000-0000-4000-8000-000000000001'''
\set curriculum_id '''00000000-0000-4000-8000-000000000002'''
\set section_id    '''00000000-0000-4000-8000-000000000003'''
\set lesson_id     '''00000000-0000-4000-8000-000000000004'''

-- ── 정리 ─────────────────────────────────────────────────────────────────
-- 순서가 있다. enrollment·subscription이 app_user를 참조하고,
-- section·lesson이 curriculum을 참조한다(ON DELETE CASCADE라 curriculum만 지우면 따라간다).
-- app_user 삭제가 ON DELETE CASCADE로 구독까지 지우지만, 명시해 두면 부분 재실행에서도 맞다.
DELETE FROM core.push_subscription
 WHERE user_id IN (SELECT id FROM core.app_user WHERE email LIKE 'bench-%@liveclass.test');
DELETE FROM core.enrollment WHERE curriculum_id = :curriculum_id::uuid;
DELETE FROM core.curriculum WHERE id = :curriculum_id::uuid;
DELETE FROM core.app_user WHERE email LIKE 'bench-%@liveclass.test';

-- ── 강사 · 커리큘럼 · 섹션 · 레슨 ────────────────────────────────────────
INSERT INTO core.app_user (id, email, password_hash, display_name, role, status)
VALUES (:instructor_id::uuid, 'bench-instructor@liveclass.test',
        '$2a$04$benchbenchbenchbenchbeuGm5xJZ8t3z8FQ0d0Xq0kYy0kZq0kZq',
        '벤치 강사', 'INSTRUCTOR', 'ACTIVE');

-- 팬아웃 SQL이 lifecycle_status를 보지는 않지만, 대상 재판정(/target)이 보므로 PUBLISHED로 둔다.
INSERT INTO core.curriculum (id, instructor_id, title, lifecycle_status, enrollment_type, published_at)
VALUES (:curriculum_id::uuid, :instructor_id::uuid, '벤치 커리큘럼', 'PUBLISHED', 'IMMEDIATE', now());

INSERT INTO core.section (id, curriculum_id, title, order_index)
VALUES (:section_id::uuid, :curriculum_id::uuid, '벤치 섹션', 0);

INSERT INTO core.lesson (id, section_id, title, order_index, status, published_at)
VALUES (:lesson_id::uuid, :section_id::uuid, '벤치 레슨', 0, 'PUBLISHED', now());

-- ── 수강생 ───────────────────────────────────────────────────────────────
-- id를 난수(gen_random_uuid)로 두는 것이 중요하다. 커서 슬라이싱이 user_id 순서로
-- 조각을 자르므로, id가 순차면 삽입 순서와 조각 순서가 같아져 실제보다 캐시가 유리해진다.
-- password_hash는 BCrypt cost 4짜리 고정값이다 — 로그인할 일이 없고, 계산하면 100만 번이다.
INSERT INTO core.app_user (id, email, password_hash, display_name, role, status)
SELECT gen_random_uuid(),
       'bench-' || i || '@liveclass.test',
       '$2a$04$benchbenchbenchbenchbeuGm5xJZ8t3z8FQ0d0Xq0kYy0kZq0kZq',
       '벤치' || i,
       'STUDENT',
       'ACTIVE'
FROM generate_series(1, :users) AS i;

-- ── 수강 ─────────────────────────────────────────────────────────────────
-- 전원 ACTIVE. 팬아웃 SQL의 조건이 정확히 이것이다
-- (curriculum_id = ? AND status = 'ACTIVE' AND user_id > 커서).
INSERT INTO core.enrollment (curriculum_id, user_id, status, enrolled_at)
SELECT :curriculum_id::uuid, u.id, 'ACTIVE', now()
FROM core.app_user u
WHERE u.email LIKE 'bench-%@liveclass.test'
  AND u.role = 'STUDENT';

-- ── 푸시 구독 ────────────────────────────────────────────────────────────
--
-- 분포: 10% 0대 · 70% 1대 · 20% 2대 → 수강생 100만이면 구독 약 120만.
-- user_id의 마지막 바이트로 가른다 — 난수 UUID라 고르게 퍼진다.
--
-- **키는 전원이 같은 쌍을 쓴다.** 암호화 비용은 키 값과 무관하고(같은 곡선·같은 연산),
-- 100만 개를 따로 만들면 시드가 그만큼 느려진다. endpoint만 달라야 하는데
-- 그건 UNIQUE 제약 때문이고 gen_random_uuid로 충분하다.
--
-- 아래 p256dh는 실제 P-256 공개점(0x04 || X || Y, base64url)이다. 임의 문자열을 넣으면
-- WebPushCrypto.decodePoint가 곡선 위의 점이 아니라며 던진다.
INSERT INTO core.push_subscription (user_id, endpoint, p256dh, auth, user_agent)
SELECT u.id,
       'http://mock-push:8080/fcm/' || gen_random_uuid(),
       'BCojbG06F33ho8nUW6XjKlo7-0fbSuSwV9yWzU-lb41fzM1jnjUWKPHbBFsuZguUxvBlo4y1Ev0kkxCitsfl_2w',
       'qQxRMcAp_mnrlvgvJd6M6w',
       'bench/' || d.device
FROM core.app_user u
CROSS JOIN LATERAL (
  SELECT generate_series(1, CASE
    WHEN ('x' || substr(replace(u.id::text, '-', ''), 31, 2))::bit(8)::int < 26  THEN 0   -- 10%
    WHEN ('x' || substr(replace(u.id::text, '-', ''), 31, 2))::bit(8)::int < 205 THEN 1   -- 70%
    ELSE 2                                                                                -- 20%
  END) AS device
) d
WHERE u.email LIKE 'bench-%@liveclass.test' AND u.role = 'STUDENT';

COMMIT;

-- ── 통계 갱신 ────────────────────────────────────────────────────────────
-- 이걸 빼면 플래너가 빈 테이블 기준 통계로 계획을 세워 커서 인덱스를 안 탄다.
-- 측정 결과가 통째로 달라지는 자리다.
ANALYZE core.app_user;
ANALYZE core.enrollment;
ANALYZE core.push_subscription;

-- ── 검증 ─────────────────────────────────────────────────────────────────
\echo ''
\echo '── 시드 결과 ──'
SELECT
  (SELECT count(*) FROM core.app_user WHERE email LIKE 'bench-%@liveclass.test' AND role = 'STUDENT') AS 수강생,
  (SELECT count(*) FROM core.enrollment WHERE curriculum_id = :curriculum_id::uuid AND status = 'ACTIVE') AS 수강_active,
  (SELECT pg_size_pretty(pg_total_relation_size('core.app_user'))) AS app_user_크기,
  (SELECT count(*) FROM core.push_subscription) AS 구독,
  (SELECT pg_size_pretty(pg_total_relation_size('core.enrollment'))) AS enrollment_크기,
  (SELECT pg_size_pretty(pg_total_relation_size('core.push_subscription'))) AS 구독_크기;

\echo ''
\echo '── 팬아웃이 쓸 커서 인덱스를 실제로 타는지 ──'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT e.user_id
FROM core.enrollment e
WHERE e.curriculum_id = :curriculum_id::uuid
  AND e.status = 'ACTIVE'
  AND e.user_id > '00000000-0000-0000-0000-000000000000'::uuid
ORDER BY e.user_id
LIMIT 1000;

\echo ''
\echo '고정 식별자 — 벤치가 이 값으로 팬아웃을 트리거한다'
\echo '  curriculum_id = 00000000-0000-4000-8000-000000000002'
\echo '  lesson_id     = 00000000-0000-4000-8000-000000000004'
\echo '  instructor_id = 00000000-0000-4000-8000-000000000001'
