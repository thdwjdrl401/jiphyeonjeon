package com.liveclass.live.web.ws;

import java.time.OffsetDateTime;

/** 세션 상태 WebSocket payload. 필드명은 공유 계약의 camelCase를 따른다. */
public record LiveSessionStatePayload(
        String liveSessionStatus,
        OffsetDateTime endedAt
) {
}
