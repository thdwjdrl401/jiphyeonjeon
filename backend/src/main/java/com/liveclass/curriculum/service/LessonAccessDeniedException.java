package com.liveclass.curriculum.service;

/**
 * 레슨은 있지만 지금 이 사람은 열 수 없다(수강하지 않음 등).
 *
 * <p>존재를 숨겨야 하는 경우(미게시 레슨·비공개 커리큘럼)는 이 예외가 아니라 404로 답한다.
 * 여기로 오는 것은 "공개 목차에서 보이긴 하는데 수강해야 열린다"는 경우뿐이라 403이 맞다 —
 * FE는 이 코드를 보고 수강 신청 동선으로 보낸다.
 */
public class LessonAccessDeniedException extends RuntimeException {

    public LessonAccessDeniedException(String message) {
        super(message);
    }
}
