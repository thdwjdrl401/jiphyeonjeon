package com.liveclass.video.service;

import java.util.UUID;

/** Spring -> media-worker RabbitMQ 계약(v1). */
public record MediaTranscodeMessage(
        String taskType,
        UUID jobId,
        UUID recordedVideoId,
        UUID lessonId,
        UUID sourceAssetId,
        String outputPrefix,
        int contractVersion
) {
}
