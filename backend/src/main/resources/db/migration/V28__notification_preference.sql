-- 곧 시작 알림의 리드타임 설정(ADR-0073 4단계).
--
-- 3단계까지는 10분 고정이었다. 이제 커리큘럼 단위로 정하고 강의별로 덮어쓸 수 있다.
CREATE TABLE core.notification_preference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid NOT NULL REFERENCES core.app_user(id) ON DELETE CASCADE,

  /** 이 설정이 걸리는 커리큘럼. 강의별 설정도 소속 커리큘럼을 함께 들고 있다(조회를 한 번에 하려고). */
  curriculum_id uuid NOT NULL REFERENCES core.curriculum(id) ON DELETE CASCADE,

  /** NULL이면 커리큘럼 전체 설정, 값이 있으면 그 강의만 덮어쓴다. */
  lesson_id uuid REFERENCES core.lesson(id) ON DELETE CASCADE,

  /*
   * 켜기/끄기를 lead_minutes NULL로 표현하지 않는다. 그러면 "행이 없다"(=기본값 쓰기)와
   * "꺼 뒀다"를 구별할 수 없고, 기본값이 바뀌는 날 꺼 둔 사람에게 알림이 되살아난다.
   */
  enabled boolean NOT NULL DEFAULT true,

  /*
   * 선택지로 제한한다(5·10·30·60·180·1440분). 자유 입력이면 누가 47분으로 바꿀 때마다 그 세션에
   * 새 예약 행을 만들어야 하고, 설정 변경이 예정 표를 건드리게 된다 — 지금은 예약 행이 선택지
   * 전부를 미리 갖고 있어서 설정이 바뀌어도 예정 표를 손대지 않는다.
   */
  lead_minutes integer NOT NULL DEFAULT 10
      CHECK (lead_minutes IN (5, 10, 30, 60, 180, 1440)),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

/*
 * 사람·커리큘럼·강의 조합은 하나뿐이다. lesson_id가 NULL일 수 있어 UNIQUE 제약만으로는
 * 커리큘럼 설정의 중복을 막지 못한다(NULL은 서로 다른 값으로 취급된다) — 부분 유니크 인덱스 둘로 나눈다.
 */
CREATE UNIQUE INDEX uq_notification_pref_lesson
    ON core.notification_preference (user_id, lesson_id)
    WHERE lesson_id IS NOT NULL;
CREATE UNIQUE INDEX uq_notification_pref_curriculum
    ON core.notification_preference (user_id, curriculum_id)
    WHERE lesson_id IS NULL;

-- 팬아웃이 "이 커리큘럼 수강생들의 설정"을 한 번에 훑는다.
CREATE INDEX idx_notification_pref_curriculum
    ON core.notification_preference (curriculum_id, user_id);

COMMENT ON TABLE core.notification_preference IS
  '곧 시작 알림의 리드타임. lesson_id가 NULL이면 커리큘럼 전체, 값이 있으면 그 강의만 덮어쓴다.';
