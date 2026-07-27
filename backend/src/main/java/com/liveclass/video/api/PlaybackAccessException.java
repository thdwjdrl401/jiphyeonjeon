package com.liveclass.video.api;

/**
 * 다시보기 재생 권한 판정 실패. video.api가 소유하므로 video의 예외 핸들러가 매핑한다 —
 * 구현 모듈(curriculum)의 예외를 video가 참조하면 순환이 되기 때문이다.
 *
 * <p>{@link Reason}으로 상태코드를 가른다: NOT_FOUND(레슨 없음, 존재 은닉) → 404,
 * ENROLLMENT_REQUIRED(레슨은 있으나 소유 강사도 활성 수강생도 아님) → 403.
 */
public class PlaybackAccessException extends RuntimeException {

    public enum Reason { NOT_FOUND, ENROLLMENT_REQUIRED }

    private final Reason reason;

    public PlaybackAccessException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }
}
