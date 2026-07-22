-- 강사 운영 목록(MY-CURRICULUM-02)이 요청마다 페이지의 커리큘럼 전체에 대해
-- "curriculum_id IN (...) AND scheduled_at ..."로 다음 라이브 세션을 배치 조회한다.
-- Postgres는 FK에 인덱스를 자동 생성하지 않아 curriculum_id 조건이 seq scan으로 떨어지므로
-- 복합 인덱스로 받는다 — 선두 컬럼이 IN 필터, 뒤 컬럼이 범위 조건 겸 정렬(V2가 추가한 FK의 인덱스 역할도 겸한다).
CREATE INDEX ix_live_session_curriculum_scheduled ON core.live_session (curriculum_id, scheduled_at);
