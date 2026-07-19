package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.domain.Section;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

@Schema(description = "섹션")
public record SectionResponse(

        String sectionId,
        String curriculumId,
        String title,
        String description,
        int orderIndex,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {

    public static SectionResponse from(Section s) {
        return new SectionResponse(
                s.getId().toString(),
                s.getCurriculumId().toString(),
                s.getTitle(),
                s.getDescription(),
                s.getOrderIndex(),
                s.getCreatedAt(),
                s.getUpdatedAt()
        );
    }
}
