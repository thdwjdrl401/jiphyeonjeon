package com.liveclass.video.service;

/**
 * 다시보기 게시 전제 위반 → 409. 자산이 아직 READY가 아니거나(녹화·확정 중, 실패) 자산이 없어 게시할 수
 * 없다. 상태 충돌이라 409로 가른다.
 */
public class ReplayPublishConflictException extends RuntimeException {
    public ReplayPublishConflictException(String message) {
        super(message);
    }
}
