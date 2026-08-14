-- 알림 문구를 사건 단위로 뽑아낸다(ADR-0123). 같은 문자열을 수신자 수만큼 저장하지 않는다.
--
-- V23은 문구를 행마다 완성해 저장했다(ADR-0073 §7). 그 결정의 핵심 근거는 "목록 조회가 단일
-- 테이블 읽기가 된다"였는데, 실측해 보니 행 ~557B 중 57%(title·message·targets·group_key ≈ 319B)가
-- 넓은 팬아웃에서 조각 전체 동일했다 — 수강생 100만이면 같은 문장이 100만 번 저장된다.
-- "만들 때 완성한 문구"라는 성질은 여기 content 행이 그대로 갖고(사건당 1행), 수신자별 행은
-- 그 행을 가리키기만 한다. 목록 조회는 단일 테이블 읽기에서 PK 조인 하나로 바뀌는데, 배지 개수
-- (60초 폴링의 주인공)는 content와 무관해 그대로 단일 테이블이다.
CREATE TABLE core.notification_content (
  id uuid PRIMARY KEY,
  -- 계약이 정한 12개 고정 union(§2-4). 임의 문자열을 넣지 않는다.
  type varchar(32) NOT NULL,
  -- 칩 색. 기준은 "지나면 늦는가"(V23과 동일).
  severity varchar(8) NOT NULL DEFAULT 'NORMAL'
      CHECK (severity IN ('NORMAL', 'HIGH', 'ERROR')),
  -- 그때 일어난 일의 기록. 커리큘럼 이름이 바뀌어도 그때 이름으로 남는다(ADR-0073 §7 유지).
  title text NOT NULL,
  message text NOT NULL,
  -- 가리키는 리소스들. 프론트 라우트 URL을 담지 않는다 — 경로가 바뀌면 쌓인 알림이 전부 깨진다.
  targets jsonb NOT NULL DEFAULT '{}'::jsonb,
  group_key varchar(200) NOT NULL,
  -- 일정 변경 알림의 변경 전·후.
  previous_starts_at timestamptz,
  next_starts_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE core.notification_content IS
  '알림 문구 원본(사건당 1행). 수신자별 행(core.notification)이 content_id로 가리킨다. '
  '좁은 팬아웃은 문구에 사람 이름이 들어가 수신자당 1행이 될 수 있다 — 그래도 경로는 한 벌이다(ADR-0123).';

-- ── 기존 행 백필 ──
--
-- 같은 문구 묶음(여덟 컬럼이 전부 같은 행들)을 한 content 행으로 접는다. 넓은 팬아웃의 조각들이
-- 자연히 하나로 모이고, 사람 이름이 들어간 좁은 팬아웃 문구는 targets(enrollmentId 등)가 달라
-- 저절로 따로 남는다. id는 묶음의 min(id)를 빌린다 — 마이그레이션 안에서만 쓰는 임시 식별자라
-- 유일하기만 하면 되고, 새로 들어올 행은 코드가 결정적 id(문구 지문 기반)를 만든다.
ALTER TABLE core.notification ADD COLUMN content_id uuid;

INSERT INTO core.notification_content
       (id, type, severity, title, message, targets, group_key,
        previous_starts_at, next_starts_at, created_at)
-- min(uuid) 집계는 Postgres에 없다(FanoutRepository의 max(uuid)와 같은 사정). text로 내려 고른다 —
-- 어차피 "묶음마다 유일한 하나"가 필요할 뿐 순서의 의미는 없다.
SELECT min(id::text)::uuid, type, severity, title, message, targets, group_key,
       previous_starts_at, next_starts_at, min(created_at)
FROM core.notification
GROUP BY type, severity, title, message, targets, group_key, previous_starts_at, next_starts_at;

-- 시각 두 칸은 NULL일 수 있어 =가 아니라 IS NOT DISTINCT FROM으로 잇는다(GROUP BY는 NULL을
-- 같은 값으로 묶으므로 여기서만 맞춰 주면 된다).
UPDATE core.notification n
   SET content_id = c.id
  FROM core.notification_content c
 WHERE n.type = c.type
   AND n.severity = c.severity
   AND n.title = c.title
   AND n.message = c.message
   AND n.targets = c.targets
   AND n.group_key = c.group_key
   AND n.previous_starts_at IS NOT DISTINCT FROM c.previous_starts_at
   AND n.next_starts_at IS NOT DISTINCT FROM c.next_starts_at;

-- 위 UPDATE가 전 행을 채웠어야 한다. 하나라도 비었으면 여기서 멈추는 편이 낫다 — NOT NULL이
-- 실패해 마이그레이션이 통째로 롤백되고, 반쯤 옮겨진 상태로 기동하는 일이 없다.
ALTER TABLE core.notification ALTER COLUMN content_id SET NOT NULL;

-- 낡은 문구 컬럼들은 여기서 지우지 않는다. V45가 표 자체를 파티션드로 재생성하며 함께 버린다 —
-- 넓은 표에서 컬럼만 떼면 죽은 공간이 남고, 어차피 행 전체를 다시 쓸 것이기 때문이다.
