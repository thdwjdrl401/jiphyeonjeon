package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.CatalogEnrollmentRecord;
import com.liveclass.curriculum.service.CatalogProgress;
import com.liveclass.curriculum.service.CatalogViewerContext;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 요청자 기준 컨텍스트. FE는 이걸로 주 CTA를 정한다 — 화면이 역할·수강상태를 다시 조합하지 않게 한다.
 *
 * <p>relationship: GUEST · UNENROLLED_STUDENT · PENDING_ENROLLMENT · ENROLLED ·
 * OWNER_INSTRUCTOR · NON_OWNER_INSTRUCTOR
 */
@Schema(description = "요청자 기준 컨텍스트")
public record ViewerContextResponse(
        String relationship,
        List<String> allowedActions,
        EnrollmentRecordResponse enrollment,
        @Schema(description = "진도. learning 패키지가 배선되지 않아 항상 null(ADR-0024).")
        ProgressResponse progress,
        @Schema(description = "다음 라이브 세션. 목차의 레슨별 liveSession으로 대체되어 현재 항상 null.")
        Object nextLiveSession
) {
    @Schema(description = "내 수강 기록 요약")
    public record EnrollmentRecordResponse(
            String enrollmentId,
            String status,
            OffsetDateTime requestedAt
    ) {
    }

    @Schema(description = "커리큘럼 진도")
    public record ProgressResponse(
            int completedLessonCount,
            int totalLessonCount,
            int progressPercent,
            LastLearningResponse lastLearning
    ) {
        @Schema(description = "마지막 학습 지점")
        public record LastLearningResponse(String lessonId, long sessionMs) {
        }
    }

    public static ViewerContextResponse from(CatalogViewerContext context) {
        return new ViewerContextResponse(
                context.relationship(),
                context.allowedActions(),
                toEnrollment(context.enrollment()),
                toProgress(context.progress()),
                null);
    }

    private static EnrollmentRecordResponse toEnrollment(CatalogEnrollmentRecord record) {
        if (record == null) {
            return null;
        }
        return new EnrollmentRecordResponse(
                record.enrollmentId().toString(), record.status(), record.requestedAt());
    }

    private static ProgressResponse toProgress(CatalogProgress progress) {
        if (progress == null) {
            return null;
        }
        var last = progress.lastLearning();
        return new ProgressResponse(
                progress.completedLessonCount(),
                progress.totalLessonCount(),
                progress.progressPercent(),
                last == null ? null
                        : new ProgressResponse.LastLearningResponse(last.lessonId().toString(), last.sessionMs()));
    }
}
