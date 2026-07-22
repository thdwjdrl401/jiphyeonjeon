package com.liveclass.auth.api;

import java.util.UUID;

/**
 * 강사 등 PII(이메일)가 필요한 곳 전용 경계 DTO. 일반 표시는 {@link UserView}를 쓰고,
 * 이메일이 실제로 필요한 좁은 경로에서만 이 채널로 조회한다(chat/live 등엔 노출 금지).
 */
public record UserContact(
        UUID userId,
        String displayName,
        String email
) {
}
