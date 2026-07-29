package com.liveclass.live.web.ws;

import com.liveclass.live.service.LiveCaptionStoredEvent;

/**
 * caption.stream.completed WS payload(camelCase). 스트림 종료 마커 — {@code lastSequence}는 attempt의
 * 마지막 순번, {@code reason}은 ROOM_DELETED다.
 */
public record CaptionCompletedPayload(
        String sttSessionId,
        long lastSequence,
        String reason
) {

    public static CaptionCompletedPayload from(LiveCaptionStoredEvent e) {
        return new CaptionCompletedPayload(e.sttSessionId(), e.lastSequence(), e.reason());
    }
}
