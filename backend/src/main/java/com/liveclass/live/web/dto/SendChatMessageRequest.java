package com.liveclass.live.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

@Schema(description = "채팅 전송 요청")
public record SendChatMessageRequest(

        @Schema(description = "클라이언트가 만든 메시지 ID(재전송 시 중복 방지)", example = "local-01J...")
        @NotBlank
        @Size(max = 64)
        String clientMessageId,

        @Schema(description = "메시지 내용")
        @NotBlank
        String text,

        @Schema(description = "질문 여부(생략 시 false)", example = "false")
        Boolean isQuestion,

        @Schema(description = "되감기 중 보고 있던 시각(ms). 현재 DDL 미저장 — 응답에 그대로 반향만.")
        Long viewingSessionMs
) {
}
