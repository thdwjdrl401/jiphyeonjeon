package com.liveclass.curriculum.service;

import java.time.OffsetDateTime;
import java.util.UUID;

/** viewerContext에 실리는 내 수강 기록 요약. 상태는 EnrollmentStatus 이름 문자열. */
public record CatalogEnrollmentRecord(
        UUID enrollmentId,
        String status,
        OffsetDateTime requestedAt
) {
}
