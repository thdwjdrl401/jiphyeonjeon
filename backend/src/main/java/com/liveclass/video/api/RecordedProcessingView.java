package com.liveclass.video.api;

import java.time.OffsetDateTime;
import java.util.UUID;

public record RecordedProcessingView(
        UUID lessonId,
        UUID recordedVideoId,
        UUID jobId,
        String status,
        String failureCode,
        Long durationMs,
        Long sizeBytes,
        OffsetDateTime readyAt
) {
}
