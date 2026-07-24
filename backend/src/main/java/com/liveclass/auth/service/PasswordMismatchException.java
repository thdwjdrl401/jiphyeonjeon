package com.liveclass.auth.service;

/** 비밀번호 변경 시 현재 비밀번호가 일치하지 않음 → 401(로그인 실패와 같은 계열). */
public class PasswordMismatchException extends RuntimeException {
    public PasswordMismatchException(String message) {
        super(message);
    }
}
