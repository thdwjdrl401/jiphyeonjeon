package com.liveclass.auth.service;

/** 임시 비밀번호 로그인 세션에서만 쓸 수 있는 경로를 다른 세션이 불렀다. */
public class TemporaryLoginRequiredException extends RuntimeException {

    public TemporaryLoginRequiredException(String message) {
        super(message);
    }
}
