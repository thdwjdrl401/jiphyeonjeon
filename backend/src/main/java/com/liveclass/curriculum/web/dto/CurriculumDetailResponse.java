package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.CatalogDetail;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 공개 커리큘럼 상세 (CURRICULUM-DETAIL-01). 기본 정보 + 강사 요약 + 섹션→레슨 목차까지.
 * viewerContext·수강정책·레슨별 access/learning·라이브 세션은 후속(정책 확정 필요).
 */
@Schema(description = "공개 커리큘럼 상세")
public record CurriculumDetailResponse(

        String curriculumId,
        String title,
        String summary,
        String description,
        @Schema(description = "표시용 이미지 URL. 미해결 시 null(썸네일 해석은 후속).")
        String thumbnailUrl,
        String lifecycleStatus,
        CurriculumPeriod period,
        InstructorSummary instructor,
        List<OutlineSection> outline
) {

    public static CurriculumDetailResponse from(CatalogDetail detail) {
        return new CurriculumDetailResponse(
                detail.curriculumId().toString(),
                detail.title(),
                detail.summary(),
                detail.description(),
                detail.thumbnailUrl(),
                detail.lifecycleStatus(),
                CurriculumPeriod.of(detail.startsAt(), detail.endsAt()),
                InstructorSummary.from(detail.instructor()),
                detail.outline().stream().map(OutlineSection::from).toList());
    }
}
