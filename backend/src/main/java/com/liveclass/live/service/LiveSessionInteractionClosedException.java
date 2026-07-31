package com.liveclass.live.service;

/** 라이브 종료 뒤 채팅·AI 쓰기 시도 → 409 LIVE_SESSION_INTERACTION_CLOSED. */
public class LiveSessionInteractionClosedException extends RuntimeException {

    public LiveSessionInteractionClosedException(String message) {
        super(message);
    }
}
