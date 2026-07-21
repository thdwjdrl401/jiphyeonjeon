package com.liveclass.enrollment.api;

import com.liveclass.enrollment.api.EnrollmentStatus;

import java.time.OffsetDateTime;
import java.util.UUID;

/** enrollment 모듈이 외부에 노출하는 경계 DTO. */
public record EnrollmentView(
        UUID id,
        UUID curriculumId,
        UUID userId,
        EnrollmentStatus status,
        OffsetDateTime requestedAt,
        OffsetDateTime decidedAt,
        OffsetDateTime enrolledAt
) {
}
