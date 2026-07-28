-- 라이브 시작 오케스트레이션의 지속 레코드(ADR-0002 §3). /start는 202를 돌려주고 실제 준비(STT dispatch,
-- Egress Gate A~C, Gate S3)는 커밋 후 비동기로 진행하므로, "지금 어떤 시작 시도가 진행 중인가"를
-- 인메모리 이벤트가 아니라 DB가 소유해야 한다.
CREATE TABLE core.live_start_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_session_id uuid NOT NULL REFERENCES core.live_session(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL UNIQUE,
  correlation_id varchar(128) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('IN_PROGRESS','SUCCEEDED','FAILED')),
  step varchar(32) NOT NULL DEFAULT 'ACCEPTED'
    CHECK (step IN ('ACCEPTED','STT_DISPATCHED','EGRESS_STARTING','EGRESS_READY','PUBLISHER_RECHECK','LIVE','FAILED')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner varchar(128) NULL,
  lease_until timestamptz NULL,
  failure_code varchar(64) NULL,
  failure_message varchar(500) NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ADR-0002 §2 "active attempt는 세션당 하나"의 최종 방어선. 애플리케이션 분기(이미 STARTING이면 기존
-- attempt 재사용)가 동시 요청에서 경합해도 두 번째 INSERT가 여기서 막힌다. 부분 유니크라 종료된
-- 시도(SUCCEEDED/FAILED)는 이력으로 얼마든지 쌓일 수 있다.
CREATE UNIQUE INDEX ux_live_start_attempt_active
  ON core.live_start_attempt (live_session_id) WHERE status = 'IN_PROGRESS';

-- 시작 상태 폴링(GET .../start-status)이 세션의 최신 시도를 찾는 경로.
CREATE INDEX ix_live_start_attempt_session_created
  ON core.live_start_attempt (live_session_id, created_at DESC);

CREATE INDEX ix_live_start_attempt_reconcile
  ON core.live_start_attempt (status, next_attempt_at, lease_until);

-- Phase 4a에서도 dispatch ID를 attempt와 함께 영속한다. job/worker/readiness 컬럼은 Phase 4b가 같은
-- 레코드를 확장해 사용하며, 지금은 dispatch 생성 뒤 ASSUMED_RUNNING으로 기록한다.
CREATE TABLE core.live_agent_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_start_attempt_id uuid NOT NULL UNIQUE REFERENCES core.live_start_attempt(id) ON DELETE CASCADE,
  live_session_id uuid NOT NULL REFERENCES core.live_session(id) ON DELETE CASCADE,
  dispatch_id varchar(128) NULL,
  agent_name varchar(128) NOT NULL,
  metadata_json text NOT NULL,
  status varchar(32) NOT NULL
    CHECK (status IN ('DISABLED','DISPATCHED','ASSUMED_RUNNING','READY','FAILED','DELETED')),
  job_id varchar(128) NULL,
  worker_id varchar(128) NULL,
  participant_identity varchar(128) NULL,
  stt_session_id varchar(128) NULL,
  ready_at timestamptz NULL,
  failure_code varchar(64) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_live_agent_job_session ON core.live_agent_job (live_session_id);

COMMENT ON TABLE core.live_start_attempt IS '라이브 시작 시도 1건(ADR-0002). STARTING 구간의 진행·실패 이력을 소유한다.';
COMMENT ON COLUMN core.live_start_attempt.operation_id IS 'FE에 돌려주는 시작 오퍼레이션 ID(202 응답·상태 폴링 키).';
COMMENT ON COLUMN core.live_start_attempt.correlation_id IS 'AgentDispatch metadata·로그 상관관계 ID. CONTRACT §3-3 규칙([A-Za-z0-9][A-Za-z0-9._:-]{0,127})을 만족한다.';
COMMENT ON COLUMN core.live_start_attempt.status IS 'IN_PROGRESS(게이트 진행 중)/SUCCEEDED(LIVE 전환)/FAILED(시작 실패, 세션은 OPEN 복귀).';
COMMENT ON COLUMN core.live_start_attempt.failure_code IS '실패 시 안정적인 오류 code(EGRESS_START_FAILED 등). 강사 재시도 UI가 이 값을 쓴다.';
COMMENT ON COLUMN core.live_start_attempt.failure_message IS '실패 사유(사람이 읽는 요약).';
COMMENT ON COLUMN core.live_start_attempt.created_at IS '행 생성 시각.';
COMMENT ON COLUMN core.live_start_attempt.updated_at IS '행 마지막 수정 시각.';
COMMENT ON TABLE core.live_agent_job IS 'start attempt에 귀속된 explicit named AgentDispatch와 STT readiness 상태.';
COMMENT ON COLUMN core.live_agent_job.status IS 'Phase 4a는 ASSUMED_RUNNING, Phase 4b는 실제 job/READY 상태를 기록한다.';
