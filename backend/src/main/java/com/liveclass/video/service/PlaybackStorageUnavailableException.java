package com.liveclass.video.service;

/** MinIO manifest 읽기 또는 세그먼트 presign 실패 → 503. */
public class PlaybackStorageUnavailableException extends RuntimeException {
    public PlaybackStorageUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
