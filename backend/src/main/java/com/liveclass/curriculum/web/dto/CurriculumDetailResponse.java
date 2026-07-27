package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.CatalogDetail;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 공개 커리큘럼 상세 (CURRICULUM-DETAIL-01). 기본 정보 + 강사 요약 + 섹션→레슨 목차에
 * 요청자 기준 컨텍스트(viewerContext)와 수강 정책까지.
 *
 * <p>materials(커리큘럼 자료)는 목차 레슨들에 연결된 활성 자료를 모은 것이다(ADR-0035).
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
        List<OutlineSection> outline,
        @Schema(description = "커리큘럼 자료(PPTX). 목차 레슨들에 연결된 활성 자료.")
        List<CurriculumMaterialResponse> materials,
        EnrollmentPolicyResponse enrollmentPolicy,
        ViewerContextResponse viewerContext
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
                detail.outline().stream().map(OutlineSection::from).toList(),
                detail.materials().stream().map(CurriculumMaterialResponse::from).toList(),
                EnrollmentPolicyResponse.from(detail.enrollmentPolicy()),
                ViewerContextResponse.from(detail.viewerContext()));
    }
}
