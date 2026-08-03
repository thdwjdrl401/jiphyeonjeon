package com.liveclass.video.api;

import java.util.UUID;

/** 녹화강의 생성 결과. lesson 생성은 curriculum, 처리 상태는 video가 소유한다. */
public record RecordedLessonView(
        UUID lessonId,
        UUID recordedVideoId,
        UUID clientRequestId,
        String processingStatus
) {
}
