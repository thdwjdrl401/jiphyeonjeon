package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.MyEnrollmentEntry;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

/**
 * 내 수강 목록 항목. 수강 기록에 커리큘럼 카드({@link CurriculumCardSummary})를 함께 싣는다 —
 * 화면이 카드를 그리려고 커리큘럼을 건건이 다시 조회하지 않도록.
 */
@Schema(description = "내 수강 목록 항목")
public record MyEnrollmentResponse(
        String enrollmentId,
        String curriculumId,
        String status,
        OffsetDateTime requestedAt,
        OffsetDateTime enrolledAt,
        CurriculumCardSummary curriculum
) {
    public static MyEnrollmentResponse from(MyEnrollmentEntry entry) {
        var enrollment = entry.enrollment();
        return new MyEnrollmentResponse(
                enrollment.id().toString(),
                enrollment.curriculumId().toString(),
                enrollment.status().name(),
                enrollment.requestedAt(),
                enrollment.enrolledAt(),
                CurriculumCardSummary.from(entry.curriculum()));
    }
}
