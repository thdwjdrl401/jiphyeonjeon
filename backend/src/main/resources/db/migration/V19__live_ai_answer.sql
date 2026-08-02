-- 라이브 AI 질의응답 기록(ADR-0047 확장). 새로고침하면 대화가 통째로 사라지던 것을 남긴다.
--
-- 지금까지 이 기능만 휘발이었다 — 채팅은 chat_message, 자막은 live_caption, 노트는 live_lecture_note에
-- 남는데 AI 답변만 브라우저 메모리에만 있었다. SSE 릴레이로 설계된 탓에 저장 지점이 없었던 것이지
-- 남기면 안 될 이유가 있었던 것은 아니다.
--
-- **개인 것이다.** 채팅과 달리 질문자 본인에게만 보인다. user_id를 조회 조건에 반드시 넣는다 —
-- 남의 질문이 보이면 "무엇을 모르는지"가 드러난다.
--
-- 스트림이 끝날 때 한 번 쓴다. delta마다 쓰면 한 답변에 수십 번 UPDATE가 나가고, 그 비용이
-- 화면에 주는 값은 없다(진행 중 텍스트는 이미 SSE로 흐르고 있다).
CREATE TABLE core.live_ai_answer (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- 서버가 채번한 요청 식별자. 같은 스트림을 두 번 저장하지 않게 하는 멱등키다.
  request_id varchar(128) NOT NULL UNIQUE,

  session_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  user_id uuid NOT NULL,

  question text NOT NULL,

  -- delta를 이어 붙인 최종 답변. 실패로 끝났으면 그때까지 받은 부분까지만 남는다.
  answer text NOT NULL DEFAULT '',

  -- 근거 목록(JSON 배열 문자열). 서버는 해석하지 않고 옮기기만 한다 — ai-api가 항목을 늘려도
  -- 마이그레이션이 따라오지 않게(판서 payload·노트 topics와 같은 규칙).
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- DONE: 정상 완료 · INSUFFICIENT: 근거 부족 · ERROR: 실패(중간에 끊긴 것 포함)
  status varchar(16) NOT NULL CHECK (status IN ('DONE', 'INSUFFICIENT', 'ERROR')),

  -- status=ERROR일 때의 안정적인 code. 아니면 null
  failure_code varchar(64),

  asked_at timestamptz NOT NULL DEFAULT now()
);

-- 새로고침 복구가 이 순서로 읽는다: 내 것만, 물어본 순서대로.
CREATE INDEX idx_live_ai_answer_session_user
  ON core.live_ai_answer (session_id, user_id, asked_at);

COMMENT ON TABLE core.live_ai_answer IS
  '라이브 AI 질의응답 기록(개인). 새로고침·재접속 복구용이며 질문자 본인에게만 보인다.';
