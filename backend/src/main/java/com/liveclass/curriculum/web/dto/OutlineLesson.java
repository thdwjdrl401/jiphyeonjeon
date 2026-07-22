package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.CatalogOutlineLesson;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "공개 목차의 레슨(최소 정보)")
public record OutlineLesson(

        String lessonId,
        String title,
        int order,
        String status
) {

    public static OutlineLesson from(CatalogOutlineLesson lesson) {
        return new OutlineLesson(
                lesson.lessonId().toString(),
                lesson.title(),
                lesson.order(),
                lesson.status());
    }
}
