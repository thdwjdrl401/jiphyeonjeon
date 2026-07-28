package com.liveclass.live.api;

import java.util.UUID;

/**
 * 세션이 {@code STARTING}으로 전이하고 start attempt가 커밋됐을 때 발행된다(ADR-0002 §2).
 * 이 이벤트를 받은 실행기가 <b>별도 스레드</b>에서 STT dispatch·Egress Gate A~C·Gate S3를 진행한다 —
 * 컨트롤러는 기다리지 않고 즉시 202를 돌려준다.
 *
 * <p>{@link LiveSessionStartedEvent}와 다르다. 이쪽은 "시작 요청을 접수했다", 저쪽은 "학생이 실제로
 * 재생할 수 있는 LIVE가 됐다"는 뜻이다.
 */
public record LiveSessionStartingEvent(
        UUID sessionId,
        UUID lessonId,
        String roomName,
        UUID attemptId,
        String correlationId,
        boolean recordingEnabled,
        boolean captionEnabled
) {
}
