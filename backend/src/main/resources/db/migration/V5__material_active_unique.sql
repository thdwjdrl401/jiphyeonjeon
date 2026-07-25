-- 같은 (레슨, 에셋) 자료의 동시 중복 연결을 DB 레벨에서 막는다(ADR-0034).
-- 앱의 사전 조회(exists)만으로는 두 요청이 동시에 들어오면 레이스로 중복 저장될 수 있어
-- 최종 방어선을 인덱스로 둔다. 부분 유니크라 소프트 삭제(DELETING/DELETED) 후 같은 자료를
-- 다시 연결하는 것은 막지 않는다 — status=ACTIVE인 행끼리만 유일하면 된다.
CREATE UNIQUE INDEX uq_material_active ON core.material_asset (lesson_id, asset_id) WHERE status = 'ACTIVE';
