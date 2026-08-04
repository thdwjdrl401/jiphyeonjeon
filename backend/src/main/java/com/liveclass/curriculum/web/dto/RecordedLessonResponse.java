package com.liveclass.curriculum.web.dto;

import com.liveclass.video.api.RecordedLessonView;

import java.util.UUID;

public record RecordedLessonResponse(
        UUID lessonId,
        UUID recordedVideoId,
        String deliveryType,
        String processingStatus
) {
    public static RecordedLessonResponse from(RecordedLessonView view) {
        return new RecordedLessonResponse(
                view.lessonId(), view.recordedVideoId(), "RECORDED", view.processingStatus());
    }
}
