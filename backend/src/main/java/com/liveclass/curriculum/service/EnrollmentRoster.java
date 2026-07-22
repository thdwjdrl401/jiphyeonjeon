package com.liveclass.curriculum.service;

import com.liveclass.enrollment.api.EnrollmentStatus;
import org.springframework.data.domain.Page;

import java.util.Map;

/**
 * 강사용 수강생 로스터 한 페이지 + 이 커리큘럼 전체의 상태별 건수(summary).
 * summary는 현재 페이지/필터와 무관하게 커리큘럼 전체 기준이다(탭 배지용).
 */
public record EnrollmentRoster(
        Page<EnrollmentApplicant> page,
        Map<EnrollmentStatus, Long> summary
) {
}
