package com.liveclass.live.web.ws;

import com.liveclass.live.service.ChatMessageStoredEvent;

import java.time.OffsetDateTime;

/**
 * 채팅 브로드캐스트 payload. REST 응답과 달리 {@code mine}이 없다 — 브로드캐스트는 뷰어별이 될 수 없어서다.
 * 라이브 중 "내 메시지" 우측 정렬은 FE가 자기 {@code clientMessageId} 에코로 판별하고(접속 중이라 메모리에
 * 있음), 콜드 복구는 REST GET의 {@code mine}으로 한다(open-questions §8). userId는 담지 않는다.
 * {@code alias}는 REST 응답과 같은 규칙이다 — 익명 전송이면 세션 한정 가명, 아니면 발신자가 스스로 지정한
 * 표시 이름(ADR-0050).
 */
public record ChatMessagePayload(
        String messageId,
        String clientMessageId,
        String lessonId,
        String sessionId,
        long sessionMs,
        String text,
        boolean isQuestion,
        String alias,
        OffsetDateTime createdAt
) {

    public static ChatMessagePayload from(ChatMessageStoredEvent e) {
        return new ChatMessagePayload(
                e.messageId(),
                e.clientMessageId(),
                e.lessonId().toString(),
                e.sessionId().toString(),
                e.sessionMs(),
                e.text(),
                e.isQuestion(),
                e.alias(),
                e.createdAt());
    }
}
