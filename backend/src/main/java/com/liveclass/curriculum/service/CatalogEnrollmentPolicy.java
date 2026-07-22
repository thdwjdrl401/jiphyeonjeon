package com.liveclass.curriculum.service;

import java.time.OffsetDateTime;

/**
 * 이 커리큘럼을 지금 신청할 수 있는가(FE CURRICULUM-DETAIL 계약).
 *
 * <p>status는 저장하지 않고 모집 창 + 현재 시각에서 파생한다(DDL {@code core.curriculum} 주석과 동일 규칙):
 * {@code UNAVAILABLE}(초대 전용·미발행) · {@code NOT_OPEN}(모집 시작 전) · {@code CLOSED}(마감) · {@code OPEN}.
 */
public record CatalogEnrollmentPolicy(
        String type,
        String status,
        OffsetDateTime opensAt,
        OffsetDateTime closesAt
) {
    public boolean isOpen() {
        return "OPEN".equals(status);
    }
}
