package com.liveclass.lesson.domain;

/**
 * 레슨 작성 생명주기 — 값이 하나다.
 *
 * <p>예전에는 DRAFT→AI_NOT_READY→READY→PUBLISHED 4단이었고 강사가 레슨을 따로 게시했다.
 * 하지만 AI_NOT_READY·READY에는 도달하는 경로가 없었고(ADR-0021), 남은 DRAFT/PUBLISHED 축은
 * 커리큘럼 lifecycle과 겹쳐 "게시 강의 5/5인데 실제 공개 0"이라는 막다른 상태를 만들었다.
 * 공개 여부는 이제 <b>커리큘럼 lifecycleStatus만</b>으로 결정한다 — 레슨은 만들어지는 순간
 * 게시 상태이고 되돌릴 상태가 없다(ADR-0005).
 *
 * <p>값이 하나여도 enum과 응답 필드는 남긴다: 공유 계약이 레슨 상태 필드를 {@code status}로
 * 규정하고 FE가 이미 그 필드를 읽는다(CONTRACT §1·§2). 필드를 없애면 계약이 깨진다.
 */
public enum LessonStatus {
    PUBLISHED
}
