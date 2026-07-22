package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.CatalogCard;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "공개 목록 카드")
public record CurriculumCardSummary(

        String curriculumId,
        String title,
        String summary,
        @Schema(description = "표시용 이미지 URL. 미해결 시 null(썸네일 해석은 후속).")
        String thumbnailUrl,
        InstructorSummary instructor,
        String lifecycleStatus,
        CurriculumPeriod period,
        int sectionCount,
        int lessonCount
) {

    public static CurriculumCardSummary from(CatalogCard card) {
        return new CurriculumCardSummary(
                card.curriculumId().toString(),
                card.title(),
                card.summary(),
                card.thumbnailUrl(),
                InstructorSummary.from(card.instructor()),
                card.lifecycleStatus(),
                CurriculumPeriod.of(card.startsAt(), card.endsAt()),
                card.sectionCount(),
                card.lessonCount());
    }
}
