-- 강조 판서 스냅샷(ADR-0074). 강사가 강조 툴로 화면 일부를 표시하면 그 순간의 화면 + 판서를 합성해
-- 잘라 둔 이미지 한 장이 한 행이다. 영실이가 답할 때 자료와 함께 근거로 쓰기 위한 것이다.
--
-- **스트로크와 수명이 다르다.** 강조 스트로크는 판서 요소라 지우개로 지워지고, 슬라이드가 넘어가면
-- 강사가 지우는 것이 정상이다. 그렇다고 이 행이 무효가 되지는 않는다 — 스냅샷은 "그 순간의 기록"이고
-- 그 순간의 강의 내용은 여전히 유효하다. 그래서 요소 id를 참조하지 않는다. 지워진 요소를 가리키는
-- FK를 두면 지우개가 근거를 날리게 된다.
--
-- **live_session을 참조한다.** 세션이 사라지면 그 순간도 없으므로 함께 지운다. lesson_id·curriculum_id는
-- 비정규화다 — 검색 스코프(curriculum)와 다시보기 앵커(lesson)를 조인 없이 쓰기 위한 것이고,
-- 부모가 사라지면 의미가 없으므로 CASCADE로 둔다(ADR-0067: ON DELETE를 안 적는 것은 선택이 아니다).
CREATE TABLE core.annotation_highlight (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_session_id uuid NOT NULL REFERENCES core.live_session(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES core.lesson(id) ON DELETE CASCADE,
  curriculum_id uuid NOT NULL REFERENCES core.curriculum(id) ON DELETE CASCADE,

  -- 합성 크롭 이미지(PNG). 실제 바이트는 스토리지에 있고 여기엔 참조만 둔다.
  asset_id uuid NOT NULL REFERENCES core.asset(id),

  -- 라이브 시작 기준 경과 ms. 채팅·자막과 같은 축이라 다시보기에서 그 시점으로 이동할 수 있다.
  session_ms bigint NOT NULL,

  -- 강사가 확인한 해석 텍스트(있을 때만). AI가 이미지를 다시 읽어 다른 텍스트를 만들면 강사 화면에
  -- 보이는 것과 근거가 갈라지므로, 우리가 가진 것을 함께 넘긴다.
  interpreted_text text NULL,

  -- 색인 상태. PENDING은 아직 안 보냄, 나머지는 AI 콜백이 확정한다(ADR-0036과 같은 규약).
  index_status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (index_status IN ('PENDING','PROCESSING','READY','FAILED')),

  -- 강사가 "이 근거 빼기"로 내린 시각. 소프트 삭제 — 색인 제거 잡이 끝나야 실제로 빠진다.
  removed_at timestamptz NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 강조 내역 패널이 세션 하나의 스냅샷을 시각순으로 훑는다.
CREATE INDEX ix_annotation_highlight_session ON core.annotation_highlight (live_session_id, session_ms);

COMMENT ON TABLE core.annotation_highlight IS
  '강조 판서 스냅샷(화면+판서 합성 크롭). 영실이 근거의 원본. 강조 스트로크와 수명이 분리된다.';
COMMENT ON COLUMN core.annotation_highlight.session_ms IS '라이브 시작 기준 경과 ms. 다시보기 근거 앵커.';
COMMENT ON COLUMN core.annotation_highlight.interpreted_text IS '강사가 확인한 해석 텍스트. 없을 수 있다.';
COMMENT ON COLUMN core.annotation_highlight.index_status IS 'AI 색인 상태. PENDING/PROCESSING/READY/FAILED.';
COMMENT ON COLUMN core.annotation_highlight.removed_at IS '강사가 근거에서 뺀 시각(소프트 삭제).';

-- 새 에셋 종류. 이미지 경로(PNG 허용·5MiB)를 그대로 타므로 앱 정책은 손대지 않는다.
ALTER TABLE core.asset DROP CONSTRAINT asset_kind_check;
ALTER TABLE core.asset ADD CONSTRAINT asset_kind_check
  CHECK (kind IN ('PROFILE_IMAGE','THUMBNAIL','MATERIAL','ANNOTATION_SNAPSHOT'));
COMMENT ON COLUMN core.asset.kind IS
  '파일 용도. PROFILE_IMAGE/THUMBNAIL/MATERIAL(PPTX)/ANNOTATION_SNAPSHOT(강조 판서 크롭).';
