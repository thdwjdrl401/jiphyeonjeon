-- ADR-0012: 업로드 녹화강의는 HLS와 batch STT가 모두 끝난 뒤 하나의 재생 패키지로 게시한다.
-- V33의 녹화강의 STT·자막 테이블을 전제로 게시 상태를 추가한다.

ALTER TABLE core.recorded_video
  ADD COLUMN publication_status varchar(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (publication_status IN ('DRAFT', 'PUBLISHED')),
  ADD COLUMN published_at timestamptz NULL;

-- 이미 READY로 학생에게 제공되던 자산을 배포 순간 숨기지 않는다. 새 행은 DEFAULT DRAFT다.
UPDATE core.recorded_video
SET publication_status = 'PUBLISHED',
    published_at = COALESCE(ready_at, updated_at, created_at)
WHERE status = 'READY';

ALTER TABLE core.recorded_video
  ADD CONSTRAINT recorded_video_publication_fields CHECK (
    (publication_status = 'DRAFT' AND published_at IS NULL)
    OR (publication_status = 'PUBLISHED' AND published_at IS NOT NULL)
  );

CREATE INDEX ix_recorded_video_draft_reconcile
  ON core.recorded_video (updated_at)
  WHERE publication_status = 'DRAFT';

COMMENT ON COLUMN core.recorded_video.publication_status IS
  'HLS+batch STT 재생 패키지 공개 상태. 새 업로드는 DRAFT, READY+READY|EMPTY에서 PUBLISHED.';
COMMENT ON COLUMN core.recorded_video.published_at IS
  '재생 패키지가 최초 자동 게시된 시각. PUBLISHED에서만 존재한다.';

COMMENT ON TABLE core.recorded_caption_track IS
  '녹화강의 자막 처리/게시 상태. READY는 재생 패키지 자동 게시와 함께 PUBLISHED가 된다.';
