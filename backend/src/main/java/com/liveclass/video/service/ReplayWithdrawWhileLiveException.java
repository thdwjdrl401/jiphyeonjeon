package com.liveclass.video.service;

/** 라이브 시청 중인 학생을 끊을 수 있는 게시 철회 요청 → 409. */
public class ReplayWithdrawWhileLiveException extends RuntimeException {
    public ReplayWithdrawWhileLiveException(String message) {
        super(message);
    }
}
