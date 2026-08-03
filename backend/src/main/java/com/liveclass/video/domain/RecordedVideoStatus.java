package com.liveclass.video.domain;

/** 업로드 녹화강의의 기술 처리 상태. 라이브 VideoAssetStatus와 의도적으로 분리한다. */
public enum RecordedVideoStatus {
    AWAITING_UPLOAD,
    QUEUED,
    TRANSCODING,
    VERIFYING,
    READY,
    FAILED
}
