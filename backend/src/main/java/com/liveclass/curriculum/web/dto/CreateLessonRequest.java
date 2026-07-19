package com.liveclass.curriculum.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(description = "레슨 생성 요청")
public record CreateLessonRequest(

        @Schema(description = "레슨 제목", example = "1. 오리엔테이션", maxLength = 200)
        @NotBlank
        @Size(max = 200)
        String title,

        @Schema(description = "레슨 설명")
        String description
) {
}
