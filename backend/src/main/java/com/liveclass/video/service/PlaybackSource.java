package com.liveclass.video.service;

/** 재생 API가 노출하는 LiveKit Egress HLS source. */
public enum PlaybackSource {
    RECENT("recent"),
    DVR("dvr");

    private final String value;

    PlaybackSource(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    public static PlaybackSource from(String value) {
        for (PlaybackSource source : values()) {
            if (source.value.equalsIgnoreCase(value)) {
                return source;
            }
        }
        throw new InvalidPlaybackSourceException("source는 recent 또는 dvr이어야 합니다.");
    }
}
