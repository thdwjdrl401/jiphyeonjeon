package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.CatalogEnrollmentPolicy;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

/**
 * 지금 이 커리큘럼을 신청할 수 있는가.
 * type: IMMEDIATE·APPROVAL_REQUIRED·INVITATION_ONLY
 * status: OPEN · NOT_OPEN(모집 시작 전) · CLOSED(마감) · UNAVAILABLE(초대 전용·미발행)
 * status는 저장값이 아니라 모집 창(opensAt·closesAt) + 현재 시각에서 파생한다.
 */
@Schema(description = "수강 신청 정책")
public record EnrollmentPolicyResponse(
        String type,
        String status,
        OffsetDateTime opensAt,
        OffsetDateTime closesAt
) {
    public static EnrollmentPolicyResponse from(CatalogEnrollmentPolicy policy) {
        return new EnrollmentPolicyResponse(policy.type(), policy.status(), policy.opensAt(), policy.closesAt());
    }
}
