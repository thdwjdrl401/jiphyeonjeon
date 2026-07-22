package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.CatalogOutlineSection;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

@Schema(description = "공개 목차의 섹션")
public record OutlineSection(

        String sectionId,
        String title,
        String description,
        int order,
        List<OutlineLesson> lessons
) {

    public static OutlineSection from(CatalogOutlineSection section) {
        return new OutlineSection(
                section.sectionId().toString(),
                section.title(),
                section.description(),
                section.order(),
                section.lessons().stream().map(OutlineLesson::from).toList());
    }
}
