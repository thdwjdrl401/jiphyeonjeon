package com.liveclass.live.service;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 파싱·검증을 마친 자막 스트림 이벤트(CONTRACT §3-4). 와이어 정본은
 * {@code ai/realtime-agent/contracts/schemas/caption-stream-entry.schema.json}이며 Redis 엔트리의 모든
 * 필드는 문자열이다. 이 레코드는 그걸 타입으로 옮긴 결과다 — {@link CaptionEventParser}가 만든다.
 *
 * <p>{@code streamElapsedMs}는 raw attempt-local ms(agent 첫 프레임=0)이며 세션 상대 ms가 아니다.
 * 변환 없이 그대로 영속·중계한다(CONTRACT §3-4 강제).
 */
public record CaptionEvent(
        String eventId,
        String type,
        UUID sessionId,
        UUID lessonId,
        String sttSessionId,
        Long sequence,
        Long lastSequence,
        long streamElapsedMs,
        String text,
        String reason,
        OffsetDateTime occurredAt
) {

    public static final String TYPE_DELTA = "caption.delta";
    public static final String TYPE_COMPLETED = "caption.stream.completed";

    public boolean isDelta() {
        return TYPE_DELTA.equals(type);
    }

    public boolean isCompleted() {
        return TYPE_COMPLETED.equals(type);
    }
}
