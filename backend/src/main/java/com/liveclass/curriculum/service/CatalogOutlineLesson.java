package com.liveclass.curriculum.service;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 공개 목차의 레슨(서비스 결과).
 *
 * <p>{@code durationMs}·{@code learning}은 학습 기록 도메인(CP5), {@code replayStatus}는 다시보기
 * 도메인(CP4)이 붙기 전까지 각각 null·NOT_READY로 고정이다. FE가 값 없음을 추측하지 않도록
 * 필드는 지금부터 계약에 포함한다.
 */
public record CatalogOutlineLesson(
        UUID lessonId,
        String title,
        int order,
        String status,
        OffsetDateTime scheduledAt,
        Long durationMs,
        CatalogLiveSession liveSession,
        String replayStatus,
        CatalogLessonAccess access,
        CatalogLessonLearning learning
) {
}
