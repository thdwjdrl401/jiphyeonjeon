package com.liveclass.curriculum.service;

import java.time.OffsetDateTime;

/**
 * 이 커리큘럼을 지금 신청할 수 있는가(FE CURRICULUM-DETAIL 계약).
 * 신청 창구 개폐 일정(opensAt·closesAt)은 도메인에 아직 없어 항상 null이다.
 */
public record CatalogEnrollmentPolicy(
        String type,
        String status,
        OffsetDateTime opensAt,
        OffsetDateTime closesAt
) {
}
