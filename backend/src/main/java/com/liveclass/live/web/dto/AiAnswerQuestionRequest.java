package com.liveclass.live.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 라이브 AI Q&A 질문(AI-QUESTION-01). {@code lessonId}·{@code contextTimeMs}·{@code requestId}는
 * <b>서버가 채운다</b> — 클라이언트 값을 신뢰하면 다른 강의 근거를 열람할 수 있다.
 */
@Schema(description = "라이브 AI 질의응답 요청")
public record AiAnswerQuestionRequest(

        @Schema(description = "질문 원문(1~4000자). 서버는 trim하지 않고 그대로 ai-api에 전달한다.",
                example = "방금 설명한 개념을 다시 정리해 주세요.")
        @NotBlank
        @Size(min = 1, max = 4000)
        String question
) {
}
