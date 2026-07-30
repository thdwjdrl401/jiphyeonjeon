-- 강사 판서 op 로그(ADR-0051). 라이브 중 강사가 그린 변경을 append-only로 적재한다.
--
-- 왜 "마지막 상태"가 아니라 op 로그인가:
--   1) 강사가 새로고침해도 문서를 접어서 복원한다.
--   2) 각 op에 세션 상대 시각(session_ms)이 붙어 "강사가 이걸 강조한 순간"으로 다시보기를 이동할 수
--      있다(자막이 쓰는 축과 동일, ADR-0045). 마지막 상태만 저장하면 이 시간축이 사라진다.
--
-- 라이브 전달 경로(LiveKit 데이터 채널)는 이 테이블과 무관하게 그대로 돈다. 저장은 곁길이며,
-- 실패해도 강사 화면과 수강생 화면은 계속 간다 — 저장이 라이브를 막지 않는다.
CREATE TABLE core.live_annotation_op (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES core.live_session (id) ON DELETE CASCADE,
  revision bigint NOT NULL,
  op_type text NOT NULL,
  payload jsonb NOT NULL,
  session_ms bigint,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_live_annotation_op_type
    CHECK (op_type IN ('snapshot', 'upsert', 'delete', 'clear'))
);

-- 문서 복원은 "마지막 snapshot 이후의 op만 접기"로 한다. 세션 전체를 접으면 강의가 길어질수록
-- 느려진다. (session_id, revision)이 그 조회의 정렬·범위 조건이다.
CREATE UNIQUE INDEX ux_live_annotation_op_session_revision
  ON core.live_annotation_op (session_id, revision);

COMMENT ON TABLE core.live_annotation_op IS '강사 판서 op append-only 로그(ADR-0051, CONTRACT §3-6b). 라이브 전달은 LiveKit 데이터 채널이 하고 이 테이블은 복원·앵커용 기록이다.';
COMMENT ON COLUMN core.live_annotation_op.revision IS '세션 안에서 단조 증가하는 op 번호. 강사가 채번하며 (session_id, revision) UNIQUE로 중복 적재를 막는다.';
COMMENT ON COLUMN core.live_annotation_op.op_type IS 'snapshot(전체 상태) · upsert(요소 추가·수정) · delete(요소 제거) · clear(전체 비움).';
COMMENT ON COLUMN core.live_annotation_op.payload IS 'op 본문(camelCase). upsert·snapshot은 elements 배열, delete는 ids 배열, clear는 빈 객체. Excalidraw 요소 JSON을 그대로 담는다.';
COMMENT ON COLUMN core.live_annotation_op.session_ms IS '세션 상대 ms(근사, ADR-0045와 같은 축). clockOriginAt이 없으면 NULL. 다시보기에서 강조 시점으로 이동하는 앵커다.';
COMMENT ON COLUMN core.live_annotation_op.occurred_at IS '강사 브라우저가 op를 만든 시각.';
COMMENT ON COLUMN core.live_annotation_op.received_at IS '서버가 적재한 시각.';
