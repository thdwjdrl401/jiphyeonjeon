package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.CatalogLessonLearning;
import com.liveclass.curriculum.service.CatalogOutlineLesson;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

/**
 * 공개 목차의 레슨. 목록 자체는 최소 정보지만, FE가 목차에서 곧바로 학습 동선을 그릴 수 있도록
 * 라이브 세션·접근 판정까지 함께 싣는다.
 */
@Schema(description = "공개 목차의 레슨")
public record OutlineLesson(
        String lessonId,
        String title,
        int order,
        String lessonStatus,
        @Schema(description = "라이브 예정 시각. 세션이 없으면 null.")
        OffsetDateTime scheduledAt,
        @Schema(description = "재생 길이. 다시보기 도메인(CP4) 전까지 항상 null.")
        Long durationMs,
        OutlineLessonLiveSession liveSession,
        @Schema(description = "NOT_READY·DRAFT·READY_FOR_REVIEW·PUBLISHED·WITHDRAWN. CP4 전까지 NOT_READY 고정.")
        String replayStatus,
        LessonAccessResponse access,
        @Schema(description = "내 학습 상태. 학습 기록 도메인(CP5) 전까지 항상 null.")
        LearningResponse learning
) {
    @Schema(description = "레슨 학습 상태")
    public record LearningResponse(boolean completed, int progressPercent) {
    }

    public static OutlineLesson from(CatalogOutlineLesson lesson) {
        return new OutlineLesson(
                lesson.lessonId().toString(),
                lesson.title(),
                lesson.order(),
                lesson.status(),
                lesson.scheduledAt(),
                lesson.durationMs(),
                OutlineLessonLiveSession.from(lesson.liveSession()),
                lesson.replayStatus(),
                LessonAccessResponse.from(lesson.access()),
                toLearning(lesson.learning()));
    }

    private static LearningResponse toLearning(CatalogLessonLearning learning) {
        if (learning == null) {
            return null;
        }
        return new LearningResponse(learning.completed(), learning.progressPercent());
    }
}
