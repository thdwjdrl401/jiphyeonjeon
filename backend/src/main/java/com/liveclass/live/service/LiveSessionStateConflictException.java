package com.liveclass.live.service;

/** 현재 상태에서 허용되지 않는 전이(예: 종료된 세션 재시작) → 409. */
public class LiveSessionStateConflictException extends RuntimeException {

    public LiveSessionStateConflictException(String message) {
        super(message);
    }
}
