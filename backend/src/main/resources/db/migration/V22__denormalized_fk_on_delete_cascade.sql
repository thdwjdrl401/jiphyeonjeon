-- 비정규화 FK가 부모 삭제를 막는 문제를 없앤다(ADR-0067).
--
-- chat_message.lesson_id와 live_session.curriculum_id는 둘 다 "편의를 위해 복사해 둔" 열이다.
-- 진짜 부모는 각각 live_session과 lesson(→section→curriculum)이고, 그 경로는 이미 ON DELETE CASCADE다.
-- 그런데 이 복사본 FK만 기본값(NO ACTION)으로 남아 있어서, 부모를 지울 때 CASCADE 정리와 NO ACTION
-- 검사가 같은 문장 안에서 경쟁한다. 검사가 먼저 닿으면 삭제가 통째로 거부된다.
--
-- 증상은 이랬다: 라이브를 한 번이라도 해서 채팅이 남은 강의("다시보기 준비 중")를 지우면 FK 위반이
-- 나고, 전역 핸들러가 그것을 "구조가 동시에 변경되었습니다. 다시 시도해 주세요"(409)로 번역해
-- 될 리 없는 재시도를 안내했다. 같은 이유로 라이브 세션이 있는 초안 커리큘럼도 지워지지 않았다.
--
-- 부모가 사라지면 이 행들은 가리킬 곳이 없어 의미가 없다. 그러므로 CASCADE가 맞다 —
-- 실제 정리도 이미 부모 경로의 CASCADE가 하고 있었고, 이 제약은 그것을 막기만 했다.
--
-- video_asset.lesson_id는 일부러 NO ACTION으로 남긴다. 녹화 자산은 행만 지우면 스토리지에 파일이
-- 남으므로 반드시 정리 경로(LessonRecordingCleanup)를 거쳐야 한다 — 여기서 CASCADE로 열어주면
-- 파일이 조용히 고아가 된다. 막히는 편이 새는 편보다 낫다.

ALTER TABLE core.chat_message
  DROP CONSTRAINT chat_message_lesson_id_fkey,
  ADD CONSTRAINT chat_message_lesson_id_fkey
    FOREIGN KEY (lesson_id) REFERENCES core.lesson(id) ON DELETE CASCADE;

ALTER TABLE core.live_session
  DROP CONSTRAINT live_session_curriculum_id_fkey,
  ADD CONSTRAINT live_session_curriculum_id_fkey
    FOREIGN KEY (curriculum_id) REFERENCES core.curriculum(id) ON DELETE CASCADE;
