package com.liveclass.video.web.dto;

import java.util.UUID;

public record RecordedSttCallbackEvent(
        String eventId,
        UUID jobId,
        UUID recordedVideoId,
        String status,
        Output output,
        String failureCode
) {
    public record Output(
            String model,
            String language,
            Long durationMs,
            Integer chunkCount,
            Integer segmentCount
    ) {
    }
}
