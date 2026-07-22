package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.InstructorNextLiveSession;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

/** 목록 카드의 "다음 일정" 요약(MY-CURRICULUM-02). 남은 예정 세션이 없으면 카드에서 null이다. */
@Schema(description = "가장 가까운 예정 라이브 세션")
public record NextLiveSessionSummary(

        String sessionId,
        String lessonId,
        @Schema(description = "세션이 걸린 레슨 제목. 레슨이 지워진 직후 등 해석 실패 시 null.")
        String lessonTitle,
        OffsetDateTime scheduledAt,
        String liveSessionStatus
) {

    public static NextLiveSessionSummary from(InstructorNextLiveSession next) {
        if (next == null) {
            return null;
        }
        return new NextLiveSessionSummary(
                next.sessionId().toString(),
                next.lessonId().toString(),
                next.lessonTitle(),
                next.scheduledAt(),
                next.liveSessionStatus());
    }
}
