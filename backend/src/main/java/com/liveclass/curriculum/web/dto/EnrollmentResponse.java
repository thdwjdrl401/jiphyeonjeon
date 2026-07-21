package com.liveclass.curriculum.web.dto;

import com.liveclass.enrollment.api.EnrollmentView;
import com.liveclass.enrollment.api.EnrollmentStatus;

import java.time.OffsetDateTime;
import java.util.UUID;

/** 수강 신청/승인 응답. (강사 대기목록의 신청자 이름 보강은 Tier 2 후속.) */
public record EnrollmentResponse(
        UUID enrollmentId,
        UUID curriculumId,
        UUID userId,
        EnrollmentStatus status,
        OffsetDateTime requestedAt,
        OffsetDateTime decidedAt,
        OffsetDateTime enrolledAt
) {
    public static EnrollmentResponse from(EnrollmentView v) {
        return new EnrollmentResponse(v.id(), v.curriculumId(), v.userId(), v.status(),
                v.requestedAt(), v.decidedAt(), v.enrolledAt());
    }
}
