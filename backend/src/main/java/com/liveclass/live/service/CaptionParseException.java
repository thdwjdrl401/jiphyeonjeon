package com.liveclass.live.service;

/**
 * 자막 엔트리 파싱·검증 실패(poison message). consumer는 이 예외를 잡아 로그 후 엔트리를 ACK로 폐기한다
 * (재시도해도 같은 결과라 pending에 남기지 않는다 — 참조 구현과 대칭).
 */
public class CaptionParseException extends RuntimeException {

    public CaptionParseException(String message) {
        super(message);
    }
}
