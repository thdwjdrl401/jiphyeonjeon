package com.liveclass.live.web.dto;

import com.liveclass.live.domain.LiveCaption;

import java.time.OffsetDateTime;

/**
 * 자막 리로드 응답 한 줄(CONTRACT §2 자막, ADR-0045). WS 델타/종료 payload와 <b>정합</b>하도록 같은
 * 필드를 그대로 노출한다 — FE가 이 목록을 WS 누적기에 그대로 시드해 새로고침·재연결 뒤 자막을 복원한다.
 * {@code type}으로 delta/completed를 구분하고, 없는 필드(예: delta의 lastSequence·reason,
 * completed의 sequence·text)는 null이다. {@code sessionMs}는 근사 세션-ms(occurredAt−clockOriginAt)이며
 * WS와 같은 계산을 쓴다(clockOriginAt이 없으면 null).
 */
public record CaptionReloadItem(
        String type,
        String sttSessionId,
        Long sequence,
        Long lastSequence,
        long streamElapsedMs,
        Long sessionMs,
        String text,
        String reason,
        OffsetDateTime occurredAt
) {

    public static CaptionReloadItem from(LiveCaption row, Long sessionMs) {
        long streamElapsedMs = row.getStreamElapsedMs() == null ? 0L : row.getStreamElapsedMs();
        return new CaptionReloadItem(
                row.getEventType(),
                row.getSttSessionId(),
                row.getSequence(),
                row.getLastSequence(),
                streamElapsedMs,
                sessionMs,
                row.getText(),
                row.getReason(),
                row.getOccurredAt());
    }
}
