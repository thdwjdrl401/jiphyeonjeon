package com.liveclass.curriculum.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;

/** PATCH 부분 수정 — 넘어온 필드만 바꾼다. 전부 선택이라 필수 검증은 없다. */
@Schema(description = "커리큘럼 기본 정보 수정 요청 (부분)")
public record UpdateCurriculumRequest(

        @Schema(description = "제목", maxLength = 200)
        @Size(max = 200)
        String title,

        @Schema(description = "카드용 짧은 소개", maxLength = 500)
        @Size(max = 500)
        String summary,

        @Schema(description = "상세 설명")
        String description
) {
}
