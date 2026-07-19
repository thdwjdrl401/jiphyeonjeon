package com.liveclass.curriculum.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(description = "섹션 생성/수정 요청")
public record SectionRequest(

        @Schema(description = "섹션 제목", example = "1주차: 환경 구성", maxLength = 200)
        @NotBlank
        @Size(max = 200)
        String title,

        @Schema(description = "섹션 설명")
        String description
) {
}
