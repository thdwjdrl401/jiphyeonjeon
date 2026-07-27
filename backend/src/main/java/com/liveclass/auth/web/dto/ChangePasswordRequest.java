package com.liveclass.auth.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(description = "비밀번호 변경 요청")
public record ChangePasswordRequest(

        @Schema(description = "현재 비밀번호")
        @NotBlank
        String currentPassword,

        @Schema(description = "새 비밀번호(8자 이상, UTF-8 72바이트 이하)", minLength = 8)
        @NotBlank
        @Size(min = 8)
        @BcryptSafeLength
        String newPassword
) {
}
