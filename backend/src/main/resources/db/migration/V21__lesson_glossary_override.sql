-- 강사가 고친 용어집. **원본이 아니라 덮어쓰기다.**
--
-- 용어집은 두 겹이다.
--   베이스: ai.material_key_term  — AI가 PPTX에서 뽑은 것(ai-worker 소유, MR !228)
--   덮어쓰기: 이 표              — 강사가 고치거나 더한 것(우리 소유)
--
-- 읽을 때 합친다. 같은 term이 양쪽에 있으면 이 표가 이긴다. 이 표에만 있으면 강사가 **추가**한
-- 용어다 — 추가를 위한 별도 표를 두지 않는다(같은 동작이라 나눌 이유가 없다).
--
-- **ai 쪽을 복사하지 않는다.** 복사하면 두 벌이 갈라지고, AI가 다시 추출했을 때 어느 쪽이 최신인지
-- 알 수 없게 된다. 같은 DB의 다른 스키마라 읽기만 하면 된다(CONTRACT §4 — 남의 스키마는 읽기만).
--
-- 키를 term 문자열로 잡는 이유: ai 쪽 PK가 (material_version_id, term)이라 자료를 다시 올리면
-- version_id가 바뀐다. 그 id를 참조하면 강사 수정이 자료 재업로드마다 끊긴다. 용어 이름은 그대로다.
CREATE TABLE core.lesson_glossary_override (
  lesson_id uuid NOT NULL,
  term varchar(200) NOT NULL,

  -- 고친 정의. 원본 정의를 그대로 두고 싶으면 이 행 자체가 없으면 된다.
  definition text NOT NULL,

  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (lesson_id, term)
);

COMMENT ON TABLE core.lesson_glossary_override IS
  '강사가 고치거나 더한 용어. ai.material_key_term을 베이스로 읽을 때 덮어쓴다.';
