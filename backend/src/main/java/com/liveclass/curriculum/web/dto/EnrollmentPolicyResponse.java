package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.CatalogEnrollmentPolicy;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

/**
 * 지금 이 커리큘럼을 신청할 수 있는가.
 * type: IMMEDIATE·APPROVAL_REQUIRED·INVITATION_ONLY / status: OPEN·UNAVAILABLE.
 * 신청 창구 개폐 일정은 도메인에 없어 opensAt·closesAt은 항상 null이다.
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
