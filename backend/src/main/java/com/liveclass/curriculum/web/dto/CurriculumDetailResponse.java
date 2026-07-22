package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.CatalogDetail;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 공개 커리큘럼 상세 (CURRICULUM-DETAIL-01). 기본 정보 + 강사 요약 + 섹션→레슨 목차에
 * 요청자 기준 컨텍스트(viewerContext)와 수강 정책까지.
 *
 * <p>materials(커리큘럼 자료)는 자료를 커리큘럼에 연결하는 API가 아직 없어 항상 빈 목록이다 —
 * FE가 값 없음을 추측하지 않도록 필드는 계약에 포함해 둔다.
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
        @Schema(description = "커리큘럼 자료(PPTX). 자료 연결 API 전까지 항상 빈 목록.")
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
                List.of(),
                EnrollmentPolicyResponse.from(detail.enrollmentPolicy()),
                ViewerContextResponse.from(detail.viewerContext()));
    }
}
