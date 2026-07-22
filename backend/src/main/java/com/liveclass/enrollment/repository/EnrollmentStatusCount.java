package com.liveclass.enrollment.repository;

import com.liveclass.enrollment.api.EnrollmentStatus;

/** 상태별 수강 건수 집계 행(GROUP BY status). 모듈 내부 전용 — 밖으로는 Map으로 나간다. */
public record EnrollmentStatusCount(EnrollmentStatus status, long count) {
}
