package com.liveclass.video.api;

import java.util.UUID;

/** curriculum이 학생 목차와 상세 게이트에 사용하는 녹화강의 공개 read model. */
public record RecordedDeliveryView(
        UUID lessonId,
        String publicationStatus,
        Long durationMs
) {
}
