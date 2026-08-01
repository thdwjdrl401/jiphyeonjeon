package com.liveclass.live.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 라이브 세션이 {@code ENDING}으로 전이돼 커밋될 때 전달할 상태 이벤트.
 * 실제 WebSocket 전송은 AFTER_COMMIT listener가 담당한다.
 */
public record LiveSessionEndingEvent(
        UUID sessionId,
        OffsetDateTime occurredAt
) {
}
