package com.liveclass.video.service;

/** 저장된 HLS manifest가 안전하게 서빙할 수 없는 URI 또는 형식을 포함함 → 409. */
public class ReplayManifestInvalidException extends RuntimeException {
    public ReplayManifestInvalidException(String message) {
        super(message);
    }
}
