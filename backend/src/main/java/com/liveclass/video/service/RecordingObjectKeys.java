package com.liveclass.video.service;

import java.util.UUID;

/** Egress 쓰기와 재생 읽기가 공유하는 녹화 객체 키 규약. */
public final class RecordingObjectKeys {

    private static final String SESSION_PREFIX = "sessions/";

    private RecordingObjectKeys() {
    }

    public static String objectPrefix(UUID sessionId) {
        return SESSION_PREFIX + sessionId;
    }

    public static String manifestKey(UUID sessionId, String playlistName) {
        return objectPrefix(sessionId) + "/" + playlistName;
    }
}
