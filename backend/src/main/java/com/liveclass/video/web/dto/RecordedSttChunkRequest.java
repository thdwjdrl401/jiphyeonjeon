package com.liveclass.video.web.dto;

import java.util.List;

public record RecordedSttChunkRequest(
        String eventId,
        Long sourceStartMs,
        Long sourceEndMs,
        String sourceSha256,
        String model,
        String language,
        List<Segment> segments
) {
    public record Segment(
            Integer localSegmentIndex,
            Long startMs,
            Long endMs,
            String text
    ) {
    }
}
