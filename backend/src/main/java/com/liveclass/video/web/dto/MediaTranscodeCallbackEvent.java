package com.liveclass.video.web.dto;

import java.util.UUID;

public record MediaTranscodeCallbackEvent(
        String eventId,
        UUID jobId,
        UUID recordedVideoId,
        String status,
        Output output,
        String failureCode
) {
    public record Output(
            String bucket,
            String hlsManifestKey,
            Long durationMs,
            Long sizeBytes,
            Integer segmentCount
    ) {
    }
}
