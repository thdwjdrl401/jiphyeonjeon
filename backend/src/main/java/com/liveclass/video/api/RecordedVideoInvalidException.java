package com.liveclass.video.api;

public class RecordedVideoInvalidException extends RuntimeException {

    private final String code;

    public RecordedVideoInvalidException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
