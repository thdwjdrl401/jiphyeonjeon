package com.liveclass.live.web.dto;

import com.liveclass.live.domain.ChatMessage;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 채팅 응답. 프라이버시 불변식: <b>내부 userId를 절대 포함하지 않고</b>, 이름은 {@code alias} 한 필드로만
 * 나간다(FE 명세). {@code alias}의 값은 발신자의 선택에 달렸다(ADR-0050) — 익명 전송이면 세션 한정 가명
 * (예: 익명1, 등장 순번 — ADR-0023), 익명을 켜지 않았으면 <b>발신자가 스스로 지정한 표시 이름</b>(displayName)이다.
 * 서버가 계정의 실명 필드를 꺼내 노출하는 경로는 없다. 강사는 언제나 표시 이름이다(익명 불가).
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
        @Schema(description = "노출 이름. 수강생이 익명 전송을 선택했으면 세션 한정 가명(익명1, 등장 순번), "
                + "선택하지 않았으면 발신자가 스스로 지정한 표시 이름이다. 강사는 항상 표시 이름(익명 불가). "
                + "userId는 어떤 경우에도 포함하지 않는다.")
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
                m.getSenderName(),   // sender_name은 저장 시점에 이미 노출용(가명 또는 표시 이름)으로 확정된다
                m.getUserId().equals(requesterId),
                m.getCreatedAt());
    }
}
