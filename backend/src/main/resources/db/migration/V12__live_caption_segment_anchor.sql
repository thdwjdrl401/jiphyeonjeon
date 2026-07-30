-- 자막 발화 경계·시간 앵커 소비 확장(ADR-0052, CONTRACT §3-4). realtime-agent가 추가로 발행하는
-- caption.stream.started(첫 오디오 프레임의 절대 UTC 앵커)·caption.segment.final(client VAD가 확정한 한
-- 발화)을 같은 append-only ingest 로그 core.live_caption에 멱등(eventId) 적재한다. 기존 delta/completed
-- 스키마·의미는 불변이며 이 변경은 순수 additive다.
--
-- 신규 type은 단일 stream_elapsed_ms가 없다(started=앵커만, segment.final=start/end 쌍) → NOT NULL을 푼다.
-- delta/completed 행은 종전처럼 항상 stream_elapsed_ms를 채운다(소비 파서가 강제).

-- 1) event_type 허용 집합을 4종으로 확장(V9의 인라인 CHECK = live_caption_event_type_check).
ALTER TABLE core.live_caption DROP CONSTRAINT live_caption_event_type_check;
ALTER TABLE core.live_caption ADD CONSTRAINT live_caption_event_type_check
  CHECK (event_type IN ('caption.delta', 'caption.stream.completed',
                        'caption.stream.started', 'caption.segment.final'));

-- 2) started/segment.final은 단일 stream_elapsed_ms가 없어 nullable로 완화.
ALTER TABLE core.live_caption ALTER COLUMN stream_elapsed_ms DROP NOT NULL;

-- 3) 신규 type 전용 컬럼(그 외 type에는 NULL).
ALTER TABLE core.live_caption
  ADD COLUMN audio_started_at        timestamptz NULL,
  ADD COLUMN segment_index           bigint NULL,
  ADD COLUMN start_stream_elapsed_ms bigint NULL,
  ADD COLUMN end_stream_elapsed_ms   bigint NULL,
  ADD COLUMN boundary_reason         varchar(16) NULL
    CONSTRAINT live_caption_boundary_reason_check
    CHECK (boundary_reason IS NULL OR boundary_reason IN ('SILENCE', 'MAX_DURATION', 'STREAM_END'));

COMMENT ON COLUMN core.live_caption.stream_elapsed_ms IS 'agent 첫 오디오 프레임=0 기준 attempt-local ms(raw). delta·completed만 채우며 started·segment.final엔 NULL. 세션 상대 ms 아님 — 변환 금지(CONTRACT §3-4).';
COMMENT ON COLUMN core.live_caption.audio_started_at IS 'caption.stream.started의 절대 시간 앵커(streamElapsedMs=0의 UTC, ADR-0052). 그 외 type엔 NULL.';
COMMENT ON COLUMN core.live_caption.segment_index IS 'caption.segment.final의 attempt 내 0-based 세그먼트 순번(ADR-0052). 그 외 type엔 NULL.';
COMMENT ON COLUMN core.live_caption.start_stream_elapsed_ms IS 'caption.segment.final 세그먼트 시작 raw attempt-local ms(ADR-0052). 그 외 type엔 NULL.';
COMMENT ON COLUMN core.live_caption.end_stream_elapsed_ms IS 'caption.segment.final 세그먼트 끝 raw attempt-local ms(ADR-0052). 그 외 type엔 NULL.';
COMMENT ON COLUMN core.live_caption.boundary_reason IS 'caption.segment.final 경계 사유(SILENCE·MAX_DURATION·STREAM_END, ADR-0052). 그 외 type엔 NULL.';
