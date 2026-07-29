-- 라이브 자막(STT) 소비 영속(ADR-0043, CONTRACT §3-4). realtime-agent가 application Redis Stream
-- `ai:captions:live`에 XADD한 caption.delta·caption.stream.completed를 Spring consumer가 소비해
-- append-only로 그대로 적재한다. 멱등키는 eventId 하나뿐이다 — retry 시 sttSessionId가 바뀌며
-- sequence가 1부터 재시작하므로 sequence에는 UNIQUE를 걸지 않는다(CONTRACT §3-4).
--
-- 시간축: raw stream_elapsed_ms(agent 첫 오디오 프레임=0 기준 attempt-local ms)만 저장한다. 세션
-- 상대 ms 변환·앵커는 후속 공유 계약이므로 session_ms 컬럼을 두지 않는다(CONTRACT §3-4 강제).
--
-- session_id·lesson_id에 FK를 걸지 않는다. 이 표는 외부(AI) 스트림의 raw ingest 로그라 core 세션
-- 행 존재 여부와 무관하게 at-least-once write를 흡수해야 한다(존재 검증은 소비/전달 경로가 담당).
CREATE TABLE core.live_caption (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id varchar(128) NOT NULL UNIQUE,
  event_type varchar(32) NOT NULL CHECK (event_type IN ('caption.delta', 'caption.stream.completed')),
  session_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  stt_session_id varchar(128) NOT NULL,
  sequence bigint NULL,
  last_sequence bigint NULL,
  stream_elapsed_ms bigint NOT NULL,
  text text NULL,
  reason varchar(32) NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- 세션별 시간순 조회(전사·정렬)용. sequence는 attempt(stt_session_id) 안에서만 단조 증가하므로
-- 세션 전체 정렬은 (stt_session_id, sequence) 또는 수신 순(id)으로 한다.
CREATE INDEX ix_live_caption_session ON core.live_caption (session_id, id);

COMMENT ON TABLE core.live_caption IS '라이브 자막 소비 append-only 적재(ADR-0043, CONTRACT §3-4). realtime-agent→Redis Stream 델타를 Spring consumer가 멱등(eventId) 저장.';
COMMENT ON COLUMN core.live_caption.id IS 'live_caption 고유 식별자(수신 순서).';
COMMENT ON COLUMN core.live_caption.event_id IS 'AI 스트림 이벤트 ID(safeIdentifier). at-least-once write의 유일한 멱등키 — UNIQUE.';
COMMENT ON COLUMN core.live_caption.event_type IS 'caption.delta(증분 자막) 또는 caption.stream.completed(스트림 종료 마커).';
COMMENT ON COLUMN core.live_caption.session_id IS '라이브 세션 ID(FK 없음 — 외부 스트림 raw ingest).';
COMMENT ON COLUMN core.live_caption.lesson_id IS '레슨 ID(비정규화, FK 없음).';
COMMENT ON COLUMN core.live_caption.stt_session_id IS 'STT job attempt 식별자(safeIdentifier). retry 시 새 값 → sequence 리셋. sequence 접기 범위.';
COMMENT ON COLUMN core.live_caption.sequence IS 'delta의 attempt-local 순번(양의 정수). completed에는 없어 NULL.';
COMMENT ON COLUMN core.live_caption.last_sequence IS 'completed가 보고한 마지막 sequence(0 이상). delta에는 없어 NULL.';
COMMENT ON COLUMN core.live_caption.stream_elapsed_ms IS 'agent 첫 오디오 프레임=0 기준 attempt-local ms(raw). 세션 상대 ms 아님 — 변환 금지(CONTRACT §3-4).';
COMMENT ON COLUMN core.live_caption.text IS 'delta 자막 본문. completed에는 없어 NULL.';
COMMENT ON COLUMN core.live_caption.reason IS 'completed 종료 사유(ROOM_DELETED). delta에는 없어 NULL.';
COMMENT ON COLUMN core.live_caption.occurred_at IS 'agent가 이벤트를 만든 시각(스트림 필드 occurredAt).';
COMMENT ON COLUMN core.live_caption.received_at IS 'Spring consumer가 적재한 시각.';
