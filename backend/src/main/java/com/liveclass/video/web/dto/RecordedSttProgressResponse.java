package com.liveclass.video.web.dto;

import java.util.List;
import java.util.UUID;

public record RecordedSttProgressResponse(
        UUID jobId,
        String status,
        boolean terminal,
        Long sourceDurationMs,
        List<CompletedChunk> completedChunks
) {
    public record CompletedChunk(int chunkIndex, String sourceSha256, int segmentCount) {
    }
}
