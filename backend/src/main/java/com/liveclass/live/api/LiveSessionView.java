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
        Integer entryWindowMinutes,
        Integer expectedDurationMinutes,
        String roomSid,
        OffsetDateTime startedAt,
        OffsetDateTime endedAt,
        boolean recordingEnabled,
        boolean captionEnabled,
        boolean chatEnabled,
        boolean aiQnaEnabled,
        /**
         * 판서를 수강생 화면에 표시 중인가(ADR-0056). 강사가 새로고침해도 <b>이전 표시 상태로</b>
         * 돌아오게 하는 값이다 — 없으면 강사 화면은 비었는데 수강생 화면에만 판서가 남는다.
         */
        boolean annotationVisible,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
}
