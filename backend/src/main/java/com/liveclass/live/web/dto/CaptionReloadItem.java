package com.liveclass.live.web.dto;

import com.liveclass.live.domain.LiveCaption;

import java.time.OffsetDateTime;

/**
 * 자막 리로드 응답 한 줄(CONTRACT §2 자막, ADR-0045·0052). WS payload와 <b>정합</b>하도록 같은 필드를
 * 그대로 노출한다 — FE가 이 목록을 WS 누적기에 그대로 시드해 새로고침·재연결 뒤 자막을 복원한다.
 * {@code type}으로 delta/completed/segment.final을 구분하고, 없는 필드는 null이다(예: delta의
 * lastSequence·reason, segment.final의 sequence·streamElapsedMs). {@code sessionMs}는 근사
 * 세션-ms(occurredAt−clockOriginAt)이며 WS와 같은 계산을 쓴다(clockOriginAt이 없으면 null).
 * `segment.final`은 권위 텍스트({@code text})와 세그먼트 경계({@code segmentIndex}·
 * {@code startStreamElapsedMs}·{@code endStreamElapsedMs}·{@code boundaryReason})를 싣는다.
 */
public record CaptionReloadItem(
        String type,
        String sttSessionId,
        Long sequence,
        Long lastSequence,
        long streamElapsedMs,
        Long sessionMs,
        Long anchoredSessionMs,
        String text,
        String reason,
        OffsetDateTime occurredAt,
        Long segmentIndex,
        Long startStreamElapsedMs,
        Long endStreamElapsedMs,
        String boundaryReason
) {

    public static CaptionReloadItem from(LiveCaption row, Long sessionMs, Long anchoredSessionMs) {
        long streamElapsedMs = row.getStreamElapsedMs() == null ? 0L : row.getStreamElapsedMs();
        return new CaptionReloadItem(
                row.getEventType(),
                row.getSttSessionId(),
                row.getSequence(),
                row.getLastSequence(),
                streamElapsedMs,
                sessionMs,
                anchoredSessionMs,
                row.getText(),
                row.getReason(),
                row.getOccurredAt(),
                row.getSegmentIndex(),
                row.getStartStreamElapsedMs(),
                row.getEndStreamElapsedMs(),
                row.getBoundaryReason());
    }
}
