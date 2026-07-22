package com.liveclass.curriculum.web.dto;

import com.liveclass.enrollment.api.EnrollmentStatus;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.Map;

/**
 * 커리큘럼 전체의 상태별 수강 건수(CURRICULUM_MANAGEMENT §8.1의 {@code summary}).
 * 계약 예시는 pending·active·revoked만 보여주지만, 필터 탭에 그대로 쓰이도록 나머지 상태도 함께 내려준다.
 */
@Schema(description = "상태별 수강 건수")
public record EnrollmentStatusSummary(
        long pending,
        long active,
        long rejected,
        long revoked,
        long cancelled
) {
    public static EnrollmentStatusSummary from(Map<EnrollmentStatus, Long> counts) {
        return new EnrollmentStatusSummary(
                count(counts, EnrollmentStatus.PENDING),
                count(counts, EnrollmentStatus.ACTIVE),
                count(counts, EnrollmentStatus.REJECTED),
                count(counts, EnrollmentStatus.REVOKED),
                count(counts, EnrollmentStatus.CANCELLED));
    }

    private static long count(Map<EnrollmentStatus, Long> counts, EnrollmentStatus status) {
        Long value = counts.get(status);
        return value == null ? 0L : value;
    }
}
