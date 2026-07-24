package com.liveclass.auth.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(description = "표시 이름 변경 요청")
public record DisplayNameRequest(

        @Schema(description = "화면 표시 이름", example = "김학생", maxLength = 100)
        @NotBlank
        @Size(max = 100)
        String displayName
) {
}
