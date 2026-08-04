package com.liveclass.lesson.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/** lesson 모듈이 공개하는 레슨 표현. 관리 응답으로도 쓴다(레슨 데이터 shape는 lesson이 소유). */
public record LessonView(

        UUID lessonId,
        UUID sectionId,
        String title,
        String description,
        int order,
        String status,
        String deliveryType,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {
}
