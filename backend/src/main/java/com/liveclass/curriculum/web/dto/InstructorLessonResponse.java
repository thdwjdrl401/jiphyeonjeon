package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.InstructorLessonDetail;
import com.liveclass.lesson.api.LessonView;
import com.liveclass.live.api.LiveSessionView;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 강사 레슨 단건 응답 = {@link LessonView} 필드 + 연결된 활성 자료(materials, ADR-0035)
 * + 이 레슨의 라이브 세션(liveSession, 있으면).
 * FE {@code ApiLessonView}와 정합 — 관리 GET이 materials를 줘야 수정 폼이 저장된 자료를,
 * liveSession을 줘야 라이브 일정을 다시 보여준다. 예전엔 세션을 공개 카탈로그에서 읽어 DRAFT에서
 * 안 보였다(강사 저작 읽기를 강사 권한 축으로 이동).
 */
@Schema(description = "강사 레슨 상세 (자료·라이브 세션 포함)")
public record InstructorLessonResponse(
        UUID lessonId,
        UUID sectionId,
        String title,
        String description,
        int order,
        String status,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        List<CurriculumMaterialResponse> materials,
        LiveSession liveSession
) {
    /** 레슨에 걸린 라이브 세션 요약(FE 편집 폼 프리필용). 없으면 필드 자체가 null. */
    @Schema(description = "레슨의 라이브 세션")
    public record LiveSession(
            UUID sessionId,
            String status,
            OffsetDateTime scheduledAt,
            Integer entryWindowMinutes,
            Integer expectedDurationMinutes
    ) {
        static LiveSession from(LiveSessionView v) {
            if (v == null) {
                return null;
            }
            return new LiveSession(v.sessionId(), v.liveSessionStatus(), v.scheduledAt(),
                    v.entryWindowMinutes(), v.expectedDurationMinutes());
        }
    }

    public static InstructorLessonResponse from(InstructorLessonDetail detail) {
        LessonView l = detail.lesson();
        return new InstructorLessonResponse(
                l.lessonId(), l.sectionId(), l.title(), l.description(), l.order(), l.status(),
                l.createdAt(), l.updatedAt(),
                detail.materials().stream().map(CurriculumMaterialResponse::from).toList(),
                LiveSession.from(detail.liveSession()));
    }
}
