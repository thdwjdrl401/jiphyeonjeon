package com.liveclass.live.web.ws;

import com.liveclass.live.service.LiveCaptionStoredEvent;

/**
 * caption.segment.final WS payload(camelCase, ADR-0052). client VAD가 확정한 한 발화다 —
 * {@code text}가 그 세그먼트의 <b>권위 텍스트</b>이고, 같은 발화의 앞선 delta 누적보다 우선한다.
 * {@code segmentIndex}는 attempt 내 0-based 순번, {@code startStreamElapsedMs}·{@code endStreamElapsedMs}는
 * raw attempt-local ms(변환 금지), {@code boundaryReason}은 SILENCE·MAX_DURATION·STREAM_END다.
 *
 * <p>{@code sessionMs}는 delta payload와 정합을 위한 근사 세션-ms({@code occurredAt−clockOriginAt},
 * nullable, ADR-0045)다. 앵커(caption.stream.started) 기반 정밀 세션-ms·seek는 후속 슬라이스다.
 */
public record CaptionSegmentPayload(
        String sttSessionId,
        long segmentIndex,
        long lastSequence,
        String text,
        long startStreamElapsedMs,
        long endStreamElapsedMs,
        String boundaryReason,
        Long sessionMs
) {

    public static CaptionSegmentPayload from(LiveCaptionStoredEvent e, Long sessionMs) {
        return new CaptionSegmentPayload(
                e.sttSessionId(), e.segmentIndex(), e.lastSequence(), e.text(),
                e.startStreamElapsedMs(), e.endStreamElapsedMs(), e.boundaryReason(), sessionMs);
    }
}
