package com.liveclass.curriculum.service;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 커리큘럼의 "다음 일정" — 가장 이른 예정 라이브 세션(서비스 계층 타입).
 * live 모듈의 세션 데이터(live.api)와 lesson 모듈의 제목(lesson.api)을 합쳐 만든다.
 */
public record InstructorNextLiveSession(

        UUID sessionId,
        UUID lessonId,
        String lessonTitle,
        OffsetDateTime scheduledAt,
        String liveSessionStatus
) {
}
