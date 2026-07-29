package com.liveclass.live.web.ws;

import com.liveclass.live.service.LiveCaptionStoredEvent;

/**
 * caption.delta WS payload(camelCase). {@code streamElapsedMs}는 raw attempt-local ms 그대로다 —
 * 세션 상대 ms로 변환하지 않는다(CONTRACT §3-4·§3-6). 변환/앵커는 후속 공유 계약.
 */
public record CaptionDeltaPayload(
        String sttSessionId,
        long sequence,
        long streamElapsedMs,
        String text
) {

    public static CaptionDeltaPayload from(LiveCaptionStoredEvent e) {
        return new CaptionDeltaPayload(e.sttSessionId(), e.sequence(), e.streamElapsedMs(), e.text());
    }
}
