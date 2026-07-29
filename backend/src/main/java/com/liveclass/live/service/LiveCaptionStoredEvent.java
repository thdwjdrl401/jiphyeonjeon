package com.liveclass.live.service;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 자막이 실제로 DB에 적재됐을 때만 발행된다(멱등 중복은 발행하지 않음). 커밋 후({@code AFTER_COMMIT})
 * 리스너가 WebSocket으로 브로드캐스트한다 — 저장 안 된 것을 실시간으로 흘리지 않기 위해
 * ({@code ChatMessageStoredEvent}와 동형). {@code streamElapsedMs}는 raw 값 그대로 싣는다(변환 금지).
 */
public record LiveCaptionStoredEvent(
        UUID sessionId,
        UUID lessonId,
        String eventType,
        String sttSessionId,
        Long sequence,
        Long lastSequence,
        long streamElapsedMs,
        String text,
        String reason,
        OffsetDateTime occurredAt
) {

    public static LiveCaptionStoredEvent from(CaptionEvent e) {
        return new LiveCaptionStoredEvent(
                e.sessionId(), e.lessonId(), e.type(), e.sttSessionId(),
                e.sequence(), e.lastSequence(), e.streamElapsedMs(), e.text(), e.reason(), e.occurredAt());
    }
}
