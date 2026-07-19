package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.domain.Curriculum;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

/** 강사 관리용 커리큘럼 뷰. 공개 카드(CurriculumCardSummary)와 달리 운영 카운터까지 노출한다. */
@Schema(description = "커리큘럼 (관리용)")
public record CurriculumResponse(

        String curriculumId,
        String title,
        String summary,
        String description,
        String lifecycleStatus,
        String enrollmentType,
        OffsetDateTime startsAt,
        OffsetDateTime endsAt,
        int sectionCount,
        int lessonCount,
        int publishedLessonCount,
        int structureVersion,
        OffsetDateTime publishedAt,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt
) {

    public static CurriculumResponse from(Curriculum c) {
        return new CurriculumResponse(
                c.getId().toString(),
                c.getTitle(),
                c.getSummary(),
                c.getDescription(),
                c.getLifecycleStatus().name(),
                c.getEnrollmentType().name(),
                c.getStartsAt(),
                c.getEndsAt(),
                c.getSectionCount(),
                c.getLessonCount(),
                c.getPublishedLessonCount(),
                c.getStructureVersion(),
                c.getPublishedAt(),
                c.getCreatedAt(),
                c.getUpdatedAt()
        );
    }
}
