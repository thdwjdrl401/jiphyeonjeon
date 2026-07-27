package com.liveclass.video.service;

/** 지원하지 않는 HLS source 요청 → 400. */
public class InvalidPlaybackSourceException extends RuntimeException {
    public InvalidPlaybackSourceException(String message) {
        super(message);
    }
}
