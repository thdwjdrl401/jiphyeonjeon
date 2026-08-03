package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.InstructorDashboardSummary;
import io.swagger.v3.oas.annotations.media.Schema;

/** 강사 대시보드 요약 응답. FE {@code InstructorDashboardSummary}와 필드를 맞춘다(camelCase). */
@Schema(description = "강사 대시보드 요약")
public record InstructorDashboardSummaryResponse(
        int totalCurriculumCount,
        int publishedCurriculumCount,
        int upcomingLiveCount,
        long totalEnrolleeCount,
        StudentLearningSummaryResponse.UpcomingLiveSessionResponse upcomingLiveSession
) {
    public static InstructorDashboardSummaryResponse from(InstructorDashboardSummary s) {
        return new InstructorDashboardSummaryResponse(
                s.totalCurriculumCount(),
                s.publishedCurriculumCount(),
                s.upcomingLiveCount(),
                s.totalEnrolleeCount(),
                s.upcomingLiveSession() == null ? null
                        : StudentLearningSummaryResponse.UpcomingLiveSessionResponse.from(s.upcomingLiveSession()));
    }
}
