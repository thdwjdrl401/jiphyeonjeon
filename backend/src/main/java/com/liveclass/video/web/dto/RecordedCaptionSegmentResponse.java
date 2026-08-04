package com.liveclass.video.web.dto;

import com.liveclass.video.domain.RecordedCaptionSegment;

/** 게시된 녹화 자막의 화면용 구조화 표현. WebVTT와 같은 원본 영상 시간축이다. */
public record RecordedCaptionSegmentResponse(
        long segmentId,
        long startMs,
        long endMs,
        String text
) {
    public static RecordedCaptionSegmentResponse from(RecordedCaptionSegment segment) {
        return new RecordedCaptionSegmentResponse(
                segment.getId(), segment.getStartMs(), segment.getEndMs(), segment.getText());
    }
}
