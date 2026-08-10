package com.liveclass.auth.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 임시 비밀번호를 새 비밀번호로 교체한다.
 *
 * <p><b>현재 비밀번호가 없다.</b> 임시 비밀번호로 로그인한 세션에서만 열리는 경로라, 그 값을 알고
 * 있다는 사실은 세션이 이미 증명한다.
 */
public record TemporaryPasswordReplacementRequest(

        @Schema(description = "새 비밀번호(8자 이상, UTF-8 72바이트 이하)", minLength = 8)
        @NotBlank
        @Size(min = 8)
        String newPassword
) {
}
