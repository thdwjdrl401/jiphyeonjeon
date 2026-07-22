package com.liveclass.curriculum.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.UUID;

/**
 * 로스터 항목의 신청자 신원(CURRICULUM_MANAGEMENT §8.1의 {@code student}).
 * 이메일은 PII라 강사 경로에서만 노출한다(auth.api.UserContact 채널). 사용자 레코드가 없으면 이름·이메일은 null.
 */
@Schema(description = "수강 신청자")
public record RosterStudent(
        UUID userId,
        String displayName,
        String email
) {
}
