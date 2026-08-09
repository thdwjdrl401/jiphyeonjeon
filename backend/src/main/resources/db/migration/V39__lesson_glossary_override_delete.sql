-- 강사가 용어를 지울 수 있게 한다.
--
-- 원본(ai 스키마)은 우리가 지울 수 없다 — ai-worker가 자료를 다시 읽을 때마다 다시 만든다.
-- 그래서 삭제도 덮어쓰기와 같은 자리에 <b>묘비</b>로 남긴다: 이 행이 있고 deleted_at이 차 있으면
-- 그 용어는 목록에서 빠진다.
--
-- 정의를 빈 문자열로 두어 삭제를 뜻하게 하지 않는다. 강사가 정의를 지웠다 다시 쓰려고 입력칸을
-- 비우는 순간과 구분되지 않고, 읽는 사람이 그 규칙을 알아야만 뜻이 서기 때문이다.
ALTER TABLE core.lesson_glossary_override
    ADD COLUMN deleted_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN core.lesson_glossary_override.deleted_at IS
    '강사가 이 용어를 지운 시각. NULL이면 살아 있는 덮어쓰기다. 같은 용어를 다시 등록하면 NULL로 되돌아간다.';
