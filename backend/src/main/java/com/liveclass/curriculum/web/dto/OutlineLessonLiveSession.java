package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.CatalogLiveSession;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

/** 목차 레슨에 걸린 라이브 세션. 레슨당 최대 하나이며, 없으면 필드 자체가 null. */
@Schema(description = "레슨의 라이브 세션")
public record OutlineLessonLiveSession(
        String sessionId,
        String status,
        OffsetDateTime scheduledAt
) {
    public static OutlineLessonLiveSession from(CatalogLiveSession session) {
        if (session == null) {
            return null;
        }
        return new OutlineLessonLiveSession(
                session.sessionId().toString(), session.status(), session.scheduledAt());
    }
}
