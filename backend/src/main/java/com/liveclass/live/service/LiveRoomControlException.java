package com.liveclass.live.service;

/** LiveKit 서버 제어 호출 실패(연결·응답 오류). 클라이언트 잘못이 아니라 상위 서비스 문제 → 502. */
public class LiveRoomControlException extends RuntimeException {

    public LiveRoomControlException(String message, Throwable cause) {
        super(message, cause);
    }
}
