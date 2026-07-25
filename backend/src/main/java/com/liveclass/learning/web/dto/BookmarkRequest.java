package com.liveclass.learning.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

@Schema(description = "북마크 추가 요청")
public record BookmarkRequest(

        @Schema(description = "북마크할 타임라인 위치(ms, 라이브·VOD 공통)")
        @NotNull @PositiveOrZero
        Long sessionMs
) {
}
