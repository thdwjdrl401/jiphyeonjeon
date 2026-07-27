package com.liveclass.enrollment.repository;

import java.util.UUID;

/** 커리큘럼별 수강생 수 집계 행(대시보드 배치 카운트). */
public record CurriculumEnrollmentCount(UUID curriculumId, long count) {
}
