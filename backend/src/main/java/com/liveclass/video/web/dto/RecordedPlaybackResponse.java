package com.liveclass.video.web.dto;

import java.util.UUID;

public record RecordedPlaybackResponse(
        UUID lessonId,
        UUID recordedVideoId,
        long durationMs,
        Source source
) {
    public record Source(String url, long availableFromMs, long availableToMs) {
    }
}
