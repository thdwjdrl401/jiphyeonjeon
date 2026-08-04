package com.liveclass.video.api;

public class RecordedVideoDisabledException extends RuntimeException {

    private final String code;

    public RecordedVideoDisabledException(String message) {
        this("RECORDED_VIDEO_DISABLED", message);
    }

    public RecordedVideoDisabledException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
