package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.StudentLearningSummary;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;
import java.util.UUID;

/** 학생 학습 요약 응답. FE {@code StudentDashboardSummary}와 필드를 맞춘다(camelCase). */
@Schema(description = "학생 학습 요약(대시보드)")
public record StudentLearningSummaryResponse(
        int inProgressCurriculumCount,
        int completedCurriculumCount,
        int averageProgress,
        int completedLessonCount,
        UpcomingLiveSessionResponse upcomingLiveSession
) {

    public static StudentLearningSummaryResponse from(StudentLearningSummary s) {
        return new StudentLearningSummaryResponse(
                s.inProgressCurriculumCount(),
                s.completedCurriculumCount(),
                s.averageProgress(),
                s.completedLessonCount(),
                s.upcomingLiveSession() == null ? null : UpcomingLiveSessionResponse.from(s.upcomingLiveSession()));
    }

    @Schema(description = "대시보드가 강조하는 다음 라이브 세션")
    public record UpcomingLiveSessionResponse(
            UUID sessionId,
            UUID lessonId,
            String lessonTitle,
            UUID curriculumId,
            String curriculumTitle,
            UUID sectionId,
            OffsetDateTime scheduledAt,
            String liveSessionStatus,
            Long durationMs
    ) {
        static UpcomingLiveSessionResponse from(StudentLearningSummary.UpcomingLiveSession t) {
            return new UpcomingLiveSessionResponse(
                    t.sessionId(), t.lessonId(), t.lessonTitle(),
                    t.curriculumId(), t.curriculumTitle(), t.sectionId(),
                    t.scheduledAt(), t.liveSessionStatus(), t.durationMs());
        }
    }
}
