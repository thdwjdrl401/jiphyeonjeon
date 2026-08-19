--
-- V48이 스왑에 쓴 임시 이름이 체크 제약에 남았다. 스키마를 열면 그대로 보인다.
--
--   "notification_flat_action_status_check"
--   "notification_flat_read_status_check"
--
-- V48은 테이블과 PK만 제 이름으로 돌렸다. 동작에는 영향이 없고 읽는 사람만 헷갈린다.
ALTER TABLE core.notification
  RENAME CONSTRAINT notification_flat_action_status_check TO notification_action_status_check;
ALTER TABLE core.notification
  RENAME CONSTRAINT notification_flat_read_status_check TO notification_read_status_check;
