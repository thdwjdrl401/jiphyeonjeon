package com.liveclass.live.web.ws;

import com.liveclass.live.service.LiveCaptionStoredEvent;

/**
 * caption.stream.completed WS payload(camelCase). 스트림 종료 마커 — {@code lastSequence}는 attempt의
 * 마지막 순번, {@code reason}은 ROOM_DELETED다. {@code sessionMs}는 델타 payload와 정합을 위한 근사
 * 세션-ms(nullable, ADR-0045)로 종료 마커 시각을 세션 축에 둔다.
 */
public record CaptionCompletedPayload(
        String sttSessionId,
        long lastSequence,
        Long sessionMs,
        Long speechSessionMs,
        String reason
) {

    public static CaptionCompletedPayload from(LiveCaptionStoredEvent e, Long sessionMs, Long speechSessionMs) {
        return new CaptionCompletedPayload(
                e.sttSessionId(), e.lastSequence(), sessionMs, speechSessionMs, e.reason());
    }
}
