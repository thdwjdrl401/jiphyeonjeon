package com.liveclass.video.service;

/** LiveKit Egress 서버 제어 실패(우리 잘못이 아닌 상위 서비스 오류). */
public class EgressControlException extends RuntimeException {

    public EgressControlException(String message, Throwable cause) {
        super(message, cause);
    }

    public EgressControlException(String message) {
        super(message);
    }
}
