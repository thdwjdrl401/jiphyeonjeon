package com.liveclass.curriculum.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;

/** PATCH 부분 수정 — 넘어온 필드만 바꾼다. */
@Schema(description = "섹션 수정 요청 (부분)")
public record UpdateSectionRequest(

        @Schema(description = "섹션 제목", maxLength = 200)
        @Size(max = 200)
        String title,

        @Schema(description = "섹션 설명")
        String description
) {
}
