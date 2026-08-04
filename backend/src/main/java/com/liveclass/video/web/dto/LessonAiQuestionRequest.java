package com.liveclass.video.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/**
 * 브라우저가 보내는 레슨 AI 질문. 업로드 녹화강의와 라이브 다시보기가 <b>같은 body</b>를 쓴다 —
 * 자산·커리큘럼·세션 ID와 자막 문맥은 전부 Spring이 확정한다.
 *
 * <p>{@code playbackMs}는 <b>플레이어가 보여 주는 시각</b>이 아니라 그 레슨의 재생 축 위치다. 라이브
 * 다시보기는 source의 {@code availableFromMs}를 더한 세션 상대 ms를 보낸다 — 라이브 도중 합류한
 * 재생본은 미디어 0이 세션 0이 아니라서, 미디어 시각을 그대로 보내면 근거 자막이 통째로 어긋난다.
 */
@Schema(description = "레슨 AI 질의응답 요청")
public record LessonAiQuestionRequest(

        @Schema(description = "질문 원문(1~4000자). 서버는 trim하지 않고 그대로 ai-api에 전달한다.",
                example = "여기서 말한 컨슈머 그룹이 뭐야?")
        @NotBlank @Size(min = 1, max = 4000) String question,

        /*
         * 필수다. primitive long이면 누락이 조용히 0이 되어 "강의 맨 앞에서 물었다"로 답해 버린다 —
         * 어느 대목을 물었는지 모르는 채 답하느니 거절하는 편이 낫다.
         */
        @Schema(description = "질문을 누른 순간의 재생 위치(ms).", example = "735000")
        @NotNull @PositiveOrZero Long playbackMs
) {
}
