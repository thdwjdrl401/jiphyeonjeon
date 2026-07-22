package com.liveclass.curriculum.service;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 카탈로그 목록 한 건(서비스 결과). 썸네일 URL·강사 요약까지 이미 해석된 상태로 담는다 —
 * 컨트롤러는 이걸 응답 DTO로 옮기기만 한다(서비스가 web 계층을 알지 않도록).
 */
public record CatalogCard(

        UUID curriculumId,
        String title,
        String summary,
        String thumbnailUrl,
        CatalogInstructor instructor,
        String lifecycleStatus,
        OffsetDateTime startsAt,
        OffsetDateTime endsAt,
        int sectionCount,
        int lessonCount
) {
}
