package com.liveclass.auth.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@Schema(description = "회원가입 요청")
public record SignupRequest(

        @Schema(description = "로그인 이메일", example = "student@liveclass.test", maxLength = 320)
        @NotBlank
        @Email
        @Size(max = 320)
        String email,

        @Schema(description = "비밀번호(8자 이상, UTF-8 72바이트 이하)", example = "password123", minLength = 8)
        @NotBlank
        @Size(min = 8)
        @BcryptSafeLength
        String password,

        @Schema(description = "화면 표시 이름", example = "김학생", maxLength = 100)
        @NotBlank
        @Size(max = 100)
        String displayName,

        @Schema(description = "가입 역할(STUDENT 또는 INSTRUCTOR)", example = "STUDENT")
        @NotNull
        SignupRole role
) {
}
