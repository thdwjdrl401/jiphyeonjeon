package com.liveclass.curriculum.service;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 카탈로그 상세(서비스 결과). 썸네일 URL·강사 요약·목차까지 조립된 상태로 담는다 —
 * 컨트롤러는 이걸 응답 DTO로 옮기기만 한다.
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
        List<CatalogOutlineSection> outline
) {
}
