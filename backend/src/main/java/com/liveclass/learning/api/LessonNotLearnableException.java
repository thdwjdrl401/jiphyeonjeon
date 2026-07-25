package com.liveclass.learning.api;

/**
 * 이 레슨을 학습할 수 없다 — 레슨이 없거나(존재를 드러내지 않으려면 호출자가 404로), 수강자가
 * 아니라 진도를 쌓을 자격이 없다(403).
 *
 * <p>learning.api가 소유하므로 learning의 예외 핸들러가 매핑한다 — 구현 모듈(curriculum)의 예외를
 * learning이 참조하면 순환이 되기 때문이다. reasonCode로 404/403을 호출부가 가른다.
 */
public class LessonNotLearnableException extends RuntimeException {

    /** NOT_FOUND: 레슨·커리큘럼이 없음(존재 은닉). FORBIDDEN: 있지만 수강자가 아님. */
    public enum Reason { NOT_FOUND, FORBIDDEN }

    private final Reason reason;

    public LessonNotLearnableException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }
}
