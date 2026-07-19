package com.liveclass.auth.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "CSRF 토큰")
public record CsrfResponse(

        @Schema(description = "변경 요청 헤더로 에코할 토큰 값")
        String token,

        @Schema(description = "토큰을 실을 헤더 이름", example = "X-XSRF-TOKEN")
        String headerName
) {
}
