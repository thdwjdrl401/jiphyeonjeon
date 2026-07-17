package com.liveclass.curriculum.web.dto;

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
}
