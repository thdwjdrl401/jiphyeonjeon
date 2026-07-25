package com.liveclass.learning.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.OffsetDateTime;

/**
 * 진도 갱신 요청. 진도율은 클라이언트가 계산해 보낸다(ADR-0032).
 * clientUpdatedAt 은 순서역전 방어용 — 없으면 서버가 방어 없이 반영한다.
 */
@Schema(description = "학습 진도 갱신 요청")
public record ProgressUpdateRequest(

        @Schema(description = "진도율 0~100(클라이언트 계산)")
        @NotNull @Min(0) @Max(100)
        Integer progressPercent,

        @Schema(description = "마지막 재생 위치(ms). 이어보기용")
        @NotNull @PositiveOrZero
        Long lastPositionMs,

        @Schema(description = "클라이언트 갱신 시각. 순서역전 방어에 쓴다(선택)")
        OffsetDateTime clientUpdatedAt
) {
}
