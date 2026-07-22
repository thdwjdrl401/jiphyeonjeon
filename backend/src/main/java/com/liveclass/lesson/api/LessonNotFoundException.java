package com.liveclass.lesson.api;

/**
 * 레슨을 찾을 수 없음 → 404. 경계(api) 예외라 curriculum 등 호출 모듈이 매핑할 수 있다.
 * 소유권 검증과 포트 호출 사이에서 레슨이 동시 삭제된 경우 등에서 발생한다.
 */
public class LessonNotFoundException extends RuntimeException {
    public LessonNotFoundException(String message) {
        super(message);
    }
}
