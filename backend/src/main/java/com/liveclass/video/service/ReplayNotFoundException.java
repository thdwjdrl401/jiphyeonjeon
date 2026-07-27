package com.liveclass.video.service;

/**
 * 재생할 다시보기가 없다 → 404. 녹화 자산 자체가 없거나(라이브를 안 했거나 녹화 비활성), 또는
 * 학생인데 아직 게시(PUBLISHED)되지 않아 존재를 드러내지 않는 경우. 소유 강사에겐 미게시가 404가 아니다.
 */
public class ReplayNotFoundException extends RuntimeException {
    public ReplayNotFoundException(String message) {
        super(message);
    }
}
