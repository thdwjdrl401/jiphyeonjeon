-- 현재 애플리케이션은 video_asset을 생성할 때 곧바로 STARTING을 명시한다.
-- 사용되지 않는 REQUESTED를 제거하고 상태 없는 삽입도 허용하지 않는다.
UPDATE core.video_asset
SET status = 'STARTING'
WHERE status = 'REQUESTED';

ALTER TABLE core.video_asset
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE core.video_asset
  DROP CONSTRAINT IF EXISTS video_asset_status_check;

ALTER TABLE core.video_asset
  ADD CONSTRAINT video_asset_status_check
  CHECK (status IN ('STARTING','RECORDING','FINALIZING','VERIFYING','READY','FAILED'));

COMMENT ON COLUMN core.video_asset.status IS
  '기술 녹화 상태(시스템). STARTING→RECORDING→FINALIZING→VERIFYING→READY/FAILED.';
