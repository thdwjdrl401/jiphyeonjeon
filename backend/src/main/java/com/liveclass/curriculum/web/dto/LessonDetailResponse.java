package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.CatalogLessonDetail;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 레슨 상세 응답. 상태 필드명은 목차·관리 응답과 같은 {@code status}다(계약 §1).
 * materials는 이 레슨에 연결된 활성 자료(PPTX)다(ADR-0035).
 */
@Schema(description = "레슨 상세")
public record LessonDetailResponse(

        String lessonId,
        String sectionId,
        String curriculumId,
        String sectionTitle,
        String curriculumTitle,
        String title,
        String description,
        int order,
        @Schema(description = "DRAFT·AI_NOT_READY·READY·PUBLISHED")
        String status,
        @Schema(description = "레슨 강의 자료(PPTX).")
        List<CurriculumMaterialResponse> materials
) {

    public static LessonDetailResponse from(CatalogLessonDetail detail) {
        return new LessonDetailResponse(
                detail.lessonId().toString(),
                detail.sectionId().toString(),
                detail.curriculumId().toString(),
                detail.sectionTitle(),
                detail.curriculumTitle(),
                detail.title(),
                detail.description(),
                detail.order(),
                detail.status(),
                detail.materials().stream().map(CurriculumMaterialResponse::from).toList());
    }
}
