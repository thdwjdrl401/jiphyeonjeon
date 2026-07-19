package com.liveclass.curriculum.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

/** 라이브 세션 생성 요청. 골격 — 일정만. 세부 옵션(입장창·기능 토글)은 후속. */
@Schema(description = "라이브 세션 생성 요청")
public record CreateLiveSessionRequest(

        @Schema(description = "예정 시각(없으면 DRAFT로 생성)", example = "2026-08-01T20:00:00+09:00")
        OffsetDateTime scheduledAt
) {
}
