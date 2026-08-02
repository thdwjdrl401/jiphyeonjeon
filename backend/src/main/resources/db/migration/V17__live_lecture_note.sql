-- 라이브 강의 노트 read model(CONTRACT §3-4a). ai-api가 application Redis Stream
-- `ai:lecture-notes:mvp`로 흘려보내는 노트를 Spring이 소비해 세션당 한 행으로 유지한다.
--
-- 왜 세션당 한 행인가: 화면이 필요로 하는 것은 "지금까지의 노트 전체"뿐이다. 조각을 이어 붙이든
-- 전체 스냅샷으로 갈아끼우든, 소비 방식이 무엇이든 결과는 같은 한 덩어리다. 이 표를 그 결과만
-- 담는 read model로 두면 producer 쪽 발행 방식이 바뀌어도 화면 계약과 저장 모델은 그대로다.
--
-- append 로그가 아니다. 원본 이벤트를 남기지 않으므로 재구성이 필요하면 Redis Stream을 다시 읽는다
-- (자막과 다른 선택 — 자막은 raw ingest 로그가 필요했지만 노트는 표시용 결과만 쓴다).
--
-- session_id에 FK를 걸지 않는다. 외부(AI) 스트림을 흡수하는 자리라 core 세션 행의 존재 여부와
-- 무관하게 write를 받아야 한다(존재 검증은 조회 경로의 인가가 담당한다).
CREATE TABLE core.live_lecture_note (
  session_id uuid PRIMARY KEY,
  lesson_id uuid NOT NULL,

  -- 이 노트가 반영한 자막 진행도. 뒤늦게 도착한 옛 노트로 최신 노트를 덮지 않기 위한 기준이다.
  covered_through_sequence bigint NOT NULL DEFAULT 0,

  -- 화면이 그대로 그리는 구조화 본문. [{topicId, title, keyPoints[]}] 형태의 JSON 배열이며
  -- 서버는 해석하지 않고 옮기기만 한다 — AI가 항목을 늘려도 마이그레이션이 따라오지 않게.
  topics jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- 같은 내용의 Markdown 표현. AI가 결정론적으로 만들어 주므로 서버가 다시 만들지 않는다.
  markdown text NOT NULL DEFAULT '',

  -- CAPTURING: 라이브 중 자라는 중 · COMPLETED: 자막 수집 종료 · REFINED: 종료 후 정제본으로 교체됨
  status varchar(16) NOT NULL DEFAULT 'CAPTURING'
    CHECK (status IN ('CAPTURING', 'COMPLETED', 'REFINED')),

  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_live_lecture_note_lesson ON core.live_lecture_note (lesson_id);

COMMENT ON TABLE core.live_lecture_note IS
  '라이브 강의 노트 read model(세션당 1행). 소비 방식과 무관하게 화면이 쓸 결과만 담는다.';
