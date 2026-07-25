package com.liveclass.curriculum.service;

import com.liveclass.lesson.api.MaterialView;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 카탈로그 상세(서비스 결과). 썸네일 URL·강사 요약·목차·보는 사람 기준 컨텍스트까지 조립된 상태로
 * 담는다 — 컨트롤러는 이걸 응답 DTO로 옮기기만 한다. materials는 목차 레슨들의 활성 자료를 모은 것이다(ADR-0035).
 */
public record CatalogDetail(
        UUID curriculumId,
        String title,
        String summary,
        String description,
        String thumbnailUrl,
        String lifecycleStatus,
        OffsetDateTime startsAt,
        OffsetDateTime endsAt,
        CatalogInstructor instructor,
        List<CatalogOutlineSection> outline,
        List<MaterialView> materials,
        CatalogEnrollmentPolicy enrollmentPolicy,
        CatalogViewerContext viewerContext
) {
}
