-- 강조 캡처 설명의 재시도와 색인 발행(ADR-0074).
--
-- **왜 필요한가.** 지금은 비전 호출이 한 번 실패하면 FAILED로 끝이었다. 게이트웨이 5xx나 순간적인
-- 네트워크 장애 하나로 그 캡처가 영영 근거가 되지 못한다 — 되돌리려면 사람이 SQL을 쳐야 한다.
-- outbox가 같은 문제를 attempt_count와 백오프로 이미 풀어 두었으므로(ADR-0036) 같은 모양을 쓴다.
--
-- **index_status의 뜻도 바로잡는다.** 텍스트를 만든 것과 AI가 색인한 것은 다른 사건인데 둘 다
-- READY로 쓰고 있었다. 강조 내역 화면이 생기면 강사에게 "준비됨"이라고 거짓말하게 된다.
--   PENDING     아직 읽지 않음
--   PROCESSING  텍스트를 만들어 AI에 보냈고 색인 결과를 기다린다
--   READY       AI 콜백으로 색인이 확정됐다
--   FAILED      재시도를 다 쓰고도 실패했다
ALTER TABLE core.annotation_highlight
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz NULL,
  ADD COLUMN last_error text NULL;

COMMENT ON COLUMN core.annotation_highlight.attempt_count IS
  '비전 설명 시도 횟수. 상한을 넘으면 FAILED로 내린다.';
COMMENT ON COLUMN core.annotation_highlight.next_attempt_at IS
  '이 시각 이후에 다시 시도한다(지수 백오프). null이면 즉시 대상.';
COMMENT ON COLUMN core.annotation_highlight.last_error IS
  '마지막 실패 사유. 왜 근거가 안 붙었는지 사람이 확인할 유일한 흔적이다.';

-- 워커가 "지금 시도할 것"을 고르는 경로. 상태 + 시각으로 좁힌다.
CREATE INDEX ix_annotation_highlight_pending
  ON core.annotation_highlight (index_status, next_attempt_at)
  WHERE removed_at IS NULL;
