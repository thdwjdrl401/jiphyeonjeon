package com.liveclass.video.service;

/**
 * 다시보기에 대한 강사 작업 권한 없음 → 403. 게시/검수는 <b>소유 강사만</b> 할 수 있다 —
 * 강사 계정이라도 남의 레슨은 게시하지 못한다.
 */
public class ReplayForbiddenException extends RuntimeException {
    public ReplayForbiddenException(String message) {
        super(message);
    }
}
