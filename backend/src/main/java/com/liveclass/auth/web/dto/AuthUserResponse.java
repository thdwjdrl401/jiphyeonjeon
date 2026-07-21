package com.liveclass.auth.web.dto;

import com.liveclass.auth.domain.AppUser;
import com.liveclass.auth.domain.Role;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "인증된 사용자")
public record AuthUserResponse(

        @Schema(description = "사용자 식별자(UUID)", example = "cac506e4-0d5b-4a2d-9a6f-025bf5c698e2")
        String userId,

        @Schema(description = "로그인 이메일", example = "student@liveclass.test")
        String email,

        @Schema(description = "화면 표시 이름", example = "김학생")
        String displayName,

        @Schema(description = "전역 역할", example = "STUDENT")
        Role role,

        @Schema(description = "표시용 프로필 이미지 URL. 미설정/미해결 시 null.")
        String profileImageUrl
) {

    public static AuthUserResponse from(AppUser user) {
        return from(user, null);
    }

    public static AuthUserResponse from(AppUser user, String profileImageUrl) {
        return new AuthUserResponse(
                user.getId().toString(),
                user.getEmail(),
                user.getDisplayName(),
                user.getRole(),
                profileImageUrl
        );
    }
}
