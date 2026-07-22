package com.liveclass.curriculum.service;

import java.util.UUID;

/** 공개 목차의 레슨(서비스 결과). */
public record CatalogOutlineLesson(

        UUID lessonId,
        String title,
        int order,
        String status
) {
}
