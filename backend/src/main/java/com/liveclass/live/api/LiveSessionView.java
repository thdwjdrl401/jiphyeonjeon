package com.liveclass.live.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/** live 모듈이 공개하는 라이브 세션 표현. 관리·조회 응답으로도 쓴다. */
public record LiveSessionView(

        UUID sessionId,
        UUID lessonId,
        UUID instructorId,
        String liveSessionStatus,
        OffsetDateTime scheduledAt,
        String roomSid,
        OffsetDateTime startedAt,
        OffsetDateTime endedAt,
        boolean recordingEnabled,
        boolean captionEnabled,
        boolean chatEnabled,
        boolean aiQnaEnabled,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
}
