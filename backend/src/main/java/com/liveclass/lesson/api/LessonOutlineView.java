package com.liveclass.lesson.api;

import java.util.UUID;

/**
 * 다른 모듈에 공개하는 목차용 레슨 뷰. lesson 모듈이 소유하며 Lesson 엔티티를 밖으로
 * 노출하지 않기 위한 경계 DTO다.
 */
public record LessonOutlineView(

        UUID lessonId,
        UUID sectionId,
        String title,
        int order,
        String status,
        String deliveryType
) {
}
