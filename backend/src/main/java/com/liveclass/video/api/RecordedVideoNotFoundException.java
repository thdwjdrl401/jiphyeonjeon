package com.liveclass.video.api;

public class RecordedVideoNotFoundException extends RuntimeException {

    public RecordedVideoNotFoundException(String message) {
        super(message);
    }
}
