package com.liveclass.auth.service;

/** 비밀번호 변경 시 새 비밀번호가 현재 비밀번호와 같음 → 409(계정 상태 충돌). */
public class PasswordUnchangedException extends RuntimeException {
    public PasswordUnchangedException(String message) {
        super(message);
    }
}
