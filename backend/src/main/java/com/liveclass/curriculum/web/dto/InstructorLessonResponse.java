package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.InstructorLessonDetail;
import com.liveclass.lesson.api.LessonView;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 강사 레슨 단건 응답 = {@link LessonView} 필드 + 연결된 활성 자료(materials, ADR-0035).
 * FE {@code ApiLessonView}(materials 포함)와 정합 — 관리 GET이 materials를 줘야 수정 폼이 저장된 자료를 다시 보여준다.
 */
@Schema(description = "강사 레슨 상세 (자료 포함)")
public record InstructorLessonResponse(
        UUID lessonId,
        UUID sectionId,
        String title,
        String description,
        int order,
        String status,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        List<CurriculumMaterialResponse> materials
) {

    public static InstructorLessonResponse from(InstructorLessonDetail detail) {
        LessonView l = detail.lesson();
        return new InstructorLessonResponse(
                l.lessonId(), l.sectionId(), l.title(), l.description(), l.order(), l.status(),
                l.createdAt(), l.updatedAt(),
                detail.materials().stream().map(CurriculumMaterialResponse::from).toList());
    }
}
