package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.CatalogLessonAccess;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 이 레슨을 열 수 있는지와 열면 갈 곳.
 * destination: LESSON_DETAIL·LIVE_SESSION·LIVE_CLASSROOM·VOD (막혔으면 null)
 * reasonCode: ENROLLMENT_REQUIRED·LESSON_NOT_PUBLISHED·LIVE_NOT_STARTED·REPLAY_NOT_PUBLISHED (열렸으면 null)
 */
@Schema(description = "레슨 접근 가능 여부")
public record LessonAccessResponse(
        boolean allowed,
        String destination,
        String reasonCode
) {
    public static LessonAccessResponse from(CatalogLessonAccess access) {
        return new LessonAccessResponse(access.allowed(), access.destination(), access.reasonCode());
    }
}
