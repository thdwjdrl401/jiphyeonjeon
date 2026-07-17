package com.liveclass.auth.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "이메일 사용 가능 여부")
public record EmailAvailabilityResponse(

        @Schema(description = "확인한 이메일", example = "student@liveclass.test")
        String email,

        @Schema(description = "사용 가능하면 true", example = "true")
        boolean available
) {
}
