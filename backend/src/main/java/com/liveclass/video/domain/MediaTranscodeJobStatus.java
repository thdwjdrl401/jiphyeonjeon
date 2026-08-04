package com.liveclass.video.domain;

/** MP4 -> HLS 변환 작업 시도의 상태. */
public enum MediaTranscodeJobStatus {
    PENDING,
    DISPATCHED,
    RUNNING,
    SUCCEEDED,
    FAILED
}
