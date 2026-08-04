package com.liveclass.video.service;

public class RecordedSttContractException extends RuntimeException {
    private final String code;
    private final boolean conflict;

    public RecordedSttContractException(String code, String message, boolean conflict) {
        super(message);
        this.code = code;
        this.conflict = conflict;
    }

    public String code() {
        return code;
    }

    public boolean conflict() {
        return conflict;
    }
}
