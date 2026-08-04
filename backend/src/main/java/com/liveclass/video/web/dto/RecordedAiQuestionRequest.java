package com.liveclass.video.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/** 브라우저가 보내는 녹화강의 AI 질문. 자산·커리큘럼 ID와 자막은 Spring이 확정한다. */
public record RecordedAiQuestionRequest(
        @NotBlank @Size(min = 1, max = 4000) String question,
        @PositiveOrZero long playbackMs
) {
}
