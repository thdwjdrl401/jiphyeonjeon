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
        @Size(max = 2000)
        String text,

        @Schema(description = "질문 여부(생략 시 false)", example = "false")
        Boolean isQuestion,

        /*
         * 익명 전송은 발신자의 선택이다(ADR-0050). 생략 시 false — isQuestion과 같은 "Boolean + 생략=false"
         * 패턴으로, 체크박스를 켜지 않은 전송(필드 없음)과 끈 전송(false)이 같은 뜻이 되게 한다.
         * 학생만 유효하고 강사가 true를 보내도 서버가 무시한다(강사 신원은 수업 진행상 드러나야 한다).
         */
        @Schema(description = "익명 전송 여부(생략 시 false). true면 세션 한정 가명, false면 발신자가 지정한 표시 이름이 "
                + "alias로 나간다. 강사는 익명이 될 수 없어 이 값을 무시한다.", example = "false")
        Boolean anonymous,

        @Schema(description = "되감기 중 보고 있던 시각(ms). 현재 DDL 미저장 — 응답에 그대로 반향만.")
        Long viewingSessionMs
) {
}
