package com.liveclass.video.service;

/** Egress는 시작됐지만 요청한 라이브 manifest가 아직 스토리지에 생성되지 않음 → 409. */
public class RecordingStartingException extends RuntimeException {
    public RecordingStartingException(String message) {
        super(message);
    }
}
