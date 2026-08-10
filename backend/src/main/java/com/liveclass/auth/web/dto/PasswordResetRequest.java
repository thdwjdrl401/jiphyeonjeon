package com.liveclass.auth.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(description = "비밀번호 찾기 요청")
public record PasswordResetRequest(

        @Schema(description = "가입한 이메일", example = "student@liveclass.test")
        @NotBlank
        @Email
        @Size(max = 320)
        String email
) {
}
