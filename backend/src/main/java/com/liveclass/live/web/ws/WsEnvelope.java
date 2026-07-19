package com.liveclass.live.web.ws;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * FE↔Spring WebSocket 공통 이벤트 봉투(LIVE.md §8.1). transport가 바뀌어도 {@code eventId}·{@code type}·
 * {@code sessionId}·(payload의) {@code sessionMs} 의미는 유지한다.
 */
public record WsEnvelope(
        String eventId,
        String type,
        String sessionId,
        OffsetDateTime occurredAt,
        Object payload
) {

    public static WsEnvelope of(String type, UUID sessionId, OffsetDateTime occurredAt, Object payload) {
        return new WsEnvelope("evt_" + UUID.randomUUID(), type, sessionId.toString(), occurredAt, payload);
    }
}
