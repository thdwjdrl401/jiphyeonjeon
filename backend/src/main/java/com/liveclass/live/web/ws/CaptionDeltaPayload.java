package com.liveclass.live.web.ws;

import com.liveclass.live.service.LiveCaptionStoredEvent;

/**
 * caption.delta WS payload(camelCase). {@code streamElapsedMs}는 raw attempt-local ms 그대로다 —
 * 세션 상대 ms로 변환하지 않는다(CONTRACT §3-4·§3-6).
 *
 * <p>{@code sessionMs}는 {@code occurredAt−clockOriginAt}로 계산한 <b>근사</b> 세션-ms(nullable)로, 학생의
 * HLS 영상 위치에 자막을 맞추는 표시용이다(ADR-0045). streamElapsedMs 변환이 아니라 별도 근사 축이며,
 * 앵커 기반 정밀화는 후속이다. clockOriginAt이 없으면 null.
 */
public record CaptionDeltaPayload(
        String sttSessionId,
        long sequence,
        long streamElapsedMs,
        Long sessionMs,
        Long anchoredSessionMs,
        String text
) {

    public static CaptionDeltaPayload from(LiveCaptionStoredEvent e, Long sessionMs, Long anchoredSessionMs) {
        return new CaptionDeltaPayload(
                e.sttSessionId(), e.sequence(), e.streamElapsedMs(), sessionMs, anchoredSessionMs, e.text());
    }
}
