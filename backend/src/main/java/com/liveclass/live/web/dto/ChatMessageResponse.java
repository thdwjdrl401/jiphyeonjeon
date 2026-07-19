package com.liveclass.live.web.dto;

import com.liveclass.live.domain.ChatMessage;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;
import java.util.UUID;

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
        @Schema(description = "요청자 본인이 보낸 메시지 여부. FE 우측 정렬용. 서버가 세션 기준으로 판정하므로 "
                + "새로고침·재접속·다른 기기에서도 정확하다. userId는 노출하지 않는다.")
        boolean mine,
        OffsetDateTime createdAt
) {

    /** @param requesterId 조회·전송 요청자 userId(세션에서 온 값). 노출하지 않고 mine 판정에만 쓴다. */
    public static ChatMessageResponse from(ChatMessage m, Long viewingSessionMs, UUID requesterId) {
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
                m.getUserId().equals(requesterId),
                m.getCreatedAt());
    }
}
