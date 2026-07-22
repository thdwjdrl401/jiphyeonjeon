package com.liveclass.curriculum.web.dto;

import com.liveclass.auth.api.UserContact;
import com.liveclass.curriculum.service.EnrollmentApplicant;
import com.liveclass.enrollment.api.EnrollmentStatus;
import com.liveclass.enrollment.api.EnrollmentView;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 강사용 수강생 로스터 항목(CURRICULUM_MANAGEMENT §8.1). 수강 기록에 신청자 신원(PII)을 보강한다.
 * {@code enrolledAt}은 계약 예시엔 없지만 기존 응답이 내려주던 값이라 유지한다(추가 필드는 계약상 허용).
 */
@Schema(description = "수강생 로스터 항목")
public record EnrollmentRosterItem(
        UUID enrollmentId,
        RosterStudent student,
        EnrollmentStatus status,
        OffsetDateTime requestedAt,
        OffsetDateTime decidedAt,
        OffsetDateTime enrolledAt,
        @Schema(description = "이 상태에서 강사가 취할 수 있는 다음 상태")
        List<EnrollmentStatus> allowedTransitions
) {
    public static EnrollmentRosterItem from(EnrollmentApplicant a) {
        EnrollmentView v = a.enrollment();
        UserContact c = a.contact();
        return new EnrollmentRosterItem(
                v.id(),
                new RosterStudent(v.userId(),
                        c != null ? c.displayName() : null,
                        c != null ? c.email() : null),
                v.status(),
                v.requestedAt(),
                v.decidedAt(),
                v.enrolledAt(),
                allowedTransitions(v.status()));
    }

    /**
     * 강사가 이 항목에 대해 취할 수 있는 전이. 학생 본인만 할 수 있는 CANCELLED는 포함하지 않는다
     * (상태기계 전체가 아니라 "강사에게 보이는 액션" 집합이다 — §8.2 표와 같다).
     */
    private static List<EnrollmentStatus> allowedTransitions(EnrollmentStatus status) {
        return switch (status) {
            case PENDING -> List.of(EnrollmentStatus.ACTIVE, EnrollmentStatus.REJECTED);
            case ACTIVE -> List.of(EnrollmentStatus.REVOKED);
            case REJECTED, REVOKED, CANCELLED -> List.of();
        };
    }
}
