package com.liveclass.video.web.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.UUID;

public record RecordedPlaybackResponse(
        UUID lessonId,
        UUID recordedVideoId,
        long durationMs,
        String recordedPublicationStatus,
        Source source,
        Captions captions
) {
    public record Source(String url, long availableFromMs, long availableToMs) {
    }

    public record Captions(String status, List<Track> tracks) {
    }

    public record Track(
            UUID trackId,
            String language,
            String label,
            String kind,
            String format,
            String url,
            long version,
            @JsonProperty("default") boolean defaultTrack
    ) {
    }
}
