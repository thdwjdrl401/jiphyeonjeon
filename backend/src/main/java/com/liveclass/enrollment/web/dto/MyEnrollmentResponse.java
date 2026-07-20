package com.liveclass.enrollment.web.dto;

import com.liveclass.enrollment.api.EnrollmentView;
import com.liveclass.enrollment.api.EnrollmentStatus;

import java.time.OffsetDateTime;
import java.util.UUID;

/** 내 수강 목록 항목. */
public record MyEnrollmentResponse(
        UUID enrollmentId,
        UUID curriculumId,
        EnrollmentStatus status,
        OffsetDateTime requestedAt,
        OffsetDateTime enrolledAt
) {
    public static MyEnrollmentResponse from(EnrollmentView v) {
        return new MyEnrollmentResponse(v.id(), v.curriculumId(), v.status(), v.requestedAt(), v.enrolledAt());
    }
}
