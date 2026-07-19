package com.liveclass.live.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

/** 라이브 세션 일정 수정 요청 (부분). 넘어온 필드만 바뀐다. */
@Schema(description = "라이브 세션 일정 수정 요청 (부분)")
public record UpdateLiveSessionRequest(

        @Schema(description = "예정 시각", example = "2026-08-01T20:00:00+09:00")
        OffsetDateTime scheduledAt,

        @Schema(description = "입장창(분): 예정 시각 몇 분 전부터 입장 가능", example = "10")
        Integer entryWindowMinutes,

        @Schema(description = "예상 진행 시간(분)", example = "90")
        Integer expectedDurationMinutes
) {
}
