package com.liveclass.live.web.dto;

import com.liveclass.live.domain.LiveAiAnswer;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

/**
 * 새로고침 뒤 대화를 되살리기 위한 기록 한 건(ADR-0047 확장).
 *
 * <p><b>내 것만 나온다.</b> 채팅과 달리 개인 질문이라 남의 것은 조회 자체가 되지 않는다.
 */
@Schema(description = "내가 이 세션에서 한 AI 질문과 받은 답변.")
public record LiveAiAnswerHistoryResponse(

        @Schema(description = "서버가 채번한 요청 식별자.")
        String requestId,

        String question,

        @Schema(description = "이어 붙인 최종 답변. 실패로 끝났으면 받은 데까지만 있다.")
        String answer,

        @Schema(description = "근거 목록(JSON 배열 문자열). 서버는 해석하지 않는다.")
        String sources,

        @Schema(description = "DONE·INSUFFICIENT·ERROR", example = "DONE")
        String status,

        @Schema(description = "status=ERROR일 때의 안정적인 code. 아니면 null.")
        String failureCode,

        OffsetDateTime askedAt) {

    public static LiveAiAnswerHistoryResponse from(LiveAiAnswer row) {
        return new LiveAiAnswerHistoryResponse(row.getRequestId(), row.getQuestion(),
                row.getAnswer() == null ? "" : row.getAnswer(),
                row.getSources() == null ? "[]" : row.getSources(),
                row.getStatus(), row.getFailureCode(), row.getAskedAt());
    }
}
