package com.liveclass.video.api;

public class RecordedVideoConflictException extends RuntimeException {

    private final String code;

    public RecordedVideoConflictException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
