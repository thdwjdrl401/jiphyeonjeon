package com.liveclass.learning.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 한 레슨의 학습 진도 요약(다른 모듈용 경계 DTO). completedAt이 있으면 완료로 친다.
 */
public record LearningProgressView(
        UUID lessonId,
        Long lastPositionMs,
        int progressPercent,
        OffsetDateTime completedAt,
        OffsetDateTime updatedAt
) {
    public boolean completed() {
        return completedAt != null;
    }
}
