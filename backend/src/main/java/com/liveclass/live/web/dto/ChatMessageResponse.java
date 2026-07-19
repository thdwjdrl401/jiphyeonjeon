package com.liveclass.live.web.dto;

import com.liveclass.live.domain.ChatMessage;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

/**
 * 채팅 응답. 프라이버시: 실명·내부 userId를 절대 포함하지 않고 alias(가명)만 노출한다(FE 명세).
 */
@Schema(description = "채팅 메시지")
public record ChatMessageResponse(

        String messageId,
        String clientMessageId,
        String lessonId,
        String sessionId,
        long sessionMs,
        @Schema(description = "되감기 중 보고 있던 시각(ms). 저장하지 않고 전송 응답에만 반향한다.")
        Long viewingSessionMs,
        String text,
        boolean isQuestion,
        @Schema(description = "가명(강사=표시 이름, 수강생=익명). 실명·userId는 포함하지 않는다.")
        String alias,
        OffsetDateTime createdAt
) {

    public static ChatMessageResponse from(ChatMessage m, Long viewingSessionMs) {
        return new ChatMessageResponse(
                String.valueOf(m.getId()),
                m.getClientMessageId(),
                m.getLessonId().toString(),
                m.getLiveSessionId().toString(),
                m.getSessionMs(),
                viewingSessionMs,
                m.getText(),
                m.isQuestion(),
                m.getSenderName(),   // sender_name은 저장 시점에 이미 가명으로 넣는다
                m.getCreatedAt());
    }
}
