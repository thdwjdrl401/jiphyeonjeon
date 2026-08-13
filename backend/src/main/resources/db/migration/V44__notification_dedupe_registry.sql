-- 중복 제거를 본체에서 떼어 전역 등록표로 옮긴다(ADR-0123).
--
-- V45가 core.notification을 월 파티셔닝하는데, 파티션 테이블에는 파티션 키가 빠진 전역 유니크를
-- 걸 수 없다 — dedupe_key 유니크가 (dedupe_key, created_at)이 되는 순간 "같은 사건을 달이 바뀌면
-- 다시 알린다"가 된다. dedupe는 월을 넘어야 한다: 다시보기를 철회했다 몇 달 뒤 재공개해도 다시
-- 알리지 않는 것(RecordingNotificationContractTest)이 이 성질에 걸려 있다.
--
-- 그래서 지문만 담는 작은 표를 따로 둔다. 파티셔닝하지 않고 영구히 산다 — 보존 정책이 본체
-- 파티션을 DROP해도 등록표는 남아, 지난 사건이 되살아나 다시 알리는 일이 없다.
--
-- 원문(varchar 300)이 아니라 md5 해시(uuid, 16B)를 담는다. 등록표는 "본 적 있는가"만 답하면
-- 되므로 원문을 보존할 이유가 없고, 행이 작을수록 이 표의 인덱스가 오래 메모리에 남는다.
-- md5 충돌로 서로 다른 사건이 접힐 확률은 2^-64 규모라 알림에서는 무시한다.
CREATE TABLE core.notification_dedupe (
  dedupe_hash uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.notification_dedupe IS
  '알림 중복 제거 전역 등록표(md5(dedupe_key)). 파티셔닝하지 않고 영구 보존 — dedupe가 월과 보존
정책을 넘어 유지된다. 넣는 쪽은 ON CONFLICT DO NOTHING으로 통과 여부를 판정한다(ADR-0123).';

-- 기존 지문 백필. dedupe_key는 유니크였으므로 충돌은 md5가 겹치는 경우뿐인데, 그 희박한 경우에도
-- 마이그레이션이 죽는 것보다 한 지문으로 접히는 쪽이 낫다(어차피 같은 지문 = 같은 사건 취급).
INSERT INTO core.notification_dedupe (dedupe_hash, created_at)
SELECT md5(dedupe_key)::uuid, created_at
FROM core.notification
ON CONFLICT (dedupe_hash) DO NOTHING;
