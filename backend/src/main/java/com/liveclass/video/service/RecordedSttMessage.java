package com.liveclass.video.service;

import java.util.UUID;

public record RecordedSttMessage(
        String taskType,
        UUID jobId,
        UUID recordedVideoId,
        UUID lessonId,
        UUID sourceAssetId,
        String language,
        int contractVersion
) {
}
