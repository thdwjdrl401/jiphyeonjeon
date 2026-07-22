package com.liveclass.curriculum.service;

import java.util.List;
import java.util.UUID;

/** 공개 목차의 섹션(서비스 결과). 레슨은 PUBLISHED만 담긴다. */
public record CatalogOutlineSection(

        UUID sectionId,
        String title,
        String description,
        int order,
        List<CatalogOutlineLesson> lessons
) {
}
