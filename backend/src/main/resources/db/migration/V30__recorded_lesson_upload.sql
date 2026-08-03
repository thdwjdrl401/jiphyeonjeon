-- ADR-0008: 업로드 녹화강의(MP4 -> HLS)를 기존 라이브 스키마와 분리해 추가한다.
-- 모든 기존 lesson은 LIVE로 유지되며 video_asset/live_session의 기존 컬럼과 상태는 바꾸지 않는다.

ALTER TABLE core.lesson
  ADD COLUMN delivery_type varchar(20) NOT NULL DEFAULT 'LIVE';

ALTER TABLE core.lesson
  ADD CONSTRAINT lesson_delivery_type_check
  CHECK (delivery_type IN ('LIVE', 'RECORDED'));

COMMENT ON COLUMN core.lesson.delivery_type IS
  '강의 전달 방식. LIVE=실시간 강의, RECORDED=MP4 업로드 녹화강의. 생성 후 변경 불가.';

ALTER TABLE core.asset DROP CONSTRAINT asset_kind_check;
ALTER TABLE core.asset
  ADD CONSTRAINT asset_kind_check
  CHECK (kind IN ('PROFILE_IMAGE', 'THUMBNAIL', 'MATERIAL', 'RECORDED_VIDEO_SOURCE', 'ANNOTATION_SNAPSHOT'));

COMMENT ON COLUMN core.asset.kind IS
  '파일 용도. PROFILE_IMAGE/THUMBNAIL/MATERIAL/RECORDED_VIDEO_SOURCE/ANNOTATION_SNAPSHOT.';

CREATE TABLE core.recorded_video (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL UNIQUE REFERENCES core.lesson(id) ON DELETE CASCADE,
  client_request_id uuid NOT NULL UNIQUE,
  source_asset_id uuid NULL UNIQUE REFERENCES core.asset(id),
  status varchar(30) NOT NULL DEFAULT 'AWAITING_UPLOAD'
    CHECK (status IN ('AWAITING_UPLOAD', 'QUEUED', 'TRANSCODING', 'VERIFYING', 'READY', 'FAILED')),
  output_bucket varchar(255) NULL,
  hls_manifest_key text NULL,
  duration_ms bigint NULL CHECK (duration_ms IS NULL OR duration_ms > 0),
  size_bytes bigint NULL CHECK (size_bytes IS NULL OR size_bytes >= 0),
  segment_count integer NULL CHECK (segment_count IS NULL OR segment_count > 0),
  failure_code varchar(100) NULL,
  ready_at timestamptz NULL,
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recorded_video_ready_fields CHECK (
    status <> 'READY' OR (
      output_bucket IS NOT NULL AND hls_manifest_key IS NOT NULL
      AND duration_ms IS NOT NULL AND size_bytes IS NOT NULL
      AND segment_count IS NOT NULL AND ready_at IS NOT NULL
      AND failure_code IS NULL
    )
  ),
  UNIQUE (output_bucket, hls_manifest_key)
);

CREATE TABLE core.media_transcode_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_video_id uuid NOT NULL REFERENCES core.recorded_video(id) ON DELETE CASCADE,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'DISPATCHED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  idempotency_key varchar(255) NOT NULL UNIQUE,
  publish_attempt_count integer NOT NULL DEFAULT 0,
  next_publish_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recorded_video_id, attempt_no)
);

CREATE UNIQUE INDEX uq_media_transcode_active_job
  ON core.media_transcode_job (recorded_video_id)
  WHERE status IN ('PENDING', 'DISPATCHED', 'RUNNING');

CREATE INDEX ix_media_transcode_dispatch
  ON core.media_transcode_job (status, next_publish_at);

COMMENT ON TABLE core.recorded_video IS
  'MP4 업로드 녹화강의의 원본 연결, HLS 처리 상태와 최종 재생 메타데이터.';
COMMENT ON TABLE core.media_transcode_job IS
  '녹화강의 MP4->HLS 변환 시도 이력이며 RabbitMQ durable dispatch source.';

-- delivery_type은 라이브/녹화 도메인 연결의 의미를 결정하므로 생성 뒤 변경할 수 없다.
CREATE OR REPLACE FUNCTION core.reject_lesson_delivery_type_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.delivery_type IS DISTINCT FROM OLD.delivery_type THEN
    RAISE EXCEPTION 'lesson delivery_type is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'lesson_delivery_type_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lesson_delivery_type_immutable
BEFORE UPDATE OF delivery_type ON core.lesson
FOR EACH ROW EXECUTE FUNCTION core.reject_lesson_delivery_type_change();

-- 서비스 검증을 우회한 동시 요청도 LIVE lesson-recorded_video 혼합을 만들지 못하게 DB에서 막는다.
CREATE OR REPLACE FUNCTION core.require_recorded_lesson_type()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM core.lesson l
    WHERE l.id = NEW.lesson_id AND l.delivery_type = 'RECORDED'
  ) THEN
    RAISE EXCEPTION 'recorded_video requires a RECORDED lesson'
      USING ERRCODE = '23514', CONSTRAINT = 'recorded_video_lesson_type_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_recorded_video_lesson_type
BEFORE INSERT OR UPDATE OF lesson_id ON core.recorded_video
FOR EACH ROW EXECUTE FUNCTION core.require_recorded_lesson_type();

CREATE OR REPLACE FUNCTION core.require_live_lesson_type()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM core.lesson l
    WHERE l.id = NEW.lesson_id AND l.delivery_type = 'LIVE'
  ) THEN
    RAISE EXCEPTION 'live_session requires a LIVE lesson'
      USING ERRCODE = '23514', CONSTRAINT = 'live_session_lesson_type_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_live_session_lesson_type
BEFORE INSERT OR UPDATE OF lesson_id ON core.live_session
FOR EACH ROW EXECUTE FUNCTION core.require_live_lesson_type();
