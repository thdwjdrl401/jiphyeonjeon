package com.liveclass.curriculum.web.dto;

import com.liveclass.auth.api.UserContact;
import com.liveclass.curriculum.service.EnrollmentApplicant;
import com.liveclass.enrollment.api.EnrollmentStatus;
import com.liveclass.enrollment.api.EnrollmentView;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 강사용 수강 목록(대기·로스터) 응답. 수강 기록에 신청자 이름·이메일(PII)을 보강한다.
 * 사용자 레코드가 없으면 studentName/studentEmail은 null.
 */
public record EnrollmentApplicantResponse(
        UUID enrollmentId,
        UUID curriculumId,
        UUID userId,
        String studentName,
        String studentEmail,
        EnrollmentStatus status,
        OffsetDateTime requestedAt,
        OffsetDateTime decidedAt,
        OffsetDateTime enrolledAt
) {
    public static EnrollmentApplicantResponse from(EnrollmentApplicant a) {
        EnrollmentView v = a.enrollment();
        UserContact c = a.contact();
        return new EnrollmentApplicantResponse(
                v.id(),
                v.curriculumId(),
                v.userId(),
                c != null ? c.displayName() : null,
                c != null ? c.email() : null,
                v.status(),
                v.requestedAt(),
                v.decidedAt(),
                v.enrolledAt());
    }
}
