package com.liveclass.live.service;

/** 세션의 강사가 아님 → 403. */
public class LiveSessionForbiddenException extends RuntimeException {

    public LiveSessionForbiddenException(String message) {
        super(message);
    }
}
