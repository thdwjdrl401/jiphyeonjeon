package com.liveclass.curriculum.service;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 공개 목차의 레슨(서비스 결과).
 *
 * <p>{@code replayStatus}·{@code durationMs}는 video 모듈의 녹화본에서 온다. 녹화가 없으면
 * NOT_READY, 라이브를 한 번 한 레슨은 DRAFT다(게시 검수 흐름이 없어 PUBLISHED에는 아직 도달하지 않는다).
 * {@code durationMs}는 녹화 완료 webhook이 채우는 값이라 그 경로 전까지는 녹화가 있어도 null이다.
 * {@code learning}은 학습 기록 도메인(learning 패키지)이 배선되지 않아 항상 null이다(ADR-0024).
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
