package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.CatalogService;
import com.liveclass.curriculum.service.CatalogSort;
import com.liveclass.curriculum.web.dto.CurriculumCardSummary;
import com.liveclass.curriculum.web.dto.CurriculumDetailResponse;
import com.liveclass.curriculum.web.dto.PageResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 공개 커리큘럼 탐색 (CATALOG-01, CURRICULUM-DETAIL-01). 비로그인도 호출 가능.
 * 인증 쿠키가 있어도 지금은 viewerContext를 붙이지 않는다(후속).
 */
@Tag(name = "카탈로그(공개)", description = "누구나(로그인 없이) 공개된 커리큘럼을 검색하고 열어볼 수 있는 조회 API.")
@RestController
public class CatalogController {

    private static final int DEFAULT_SIZE = 20;
    private static final int MAX_SIZE = 100;

    private final CatalogService catalogService;

    public CatalogController(CatalogService catalogService) {
        this.catalogService = catalogService;
    }

    @Operation(summary = "공개 커리큘럼 목록", description = "공개된 커리큘럼을 검색·정렬·페이지로 조회한다. q로 제목·소개를 검색할 수 있다.")
    @GetMapping("/api/curriculums")
    public PageResponse<CurriculumCardSummary> list(
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "LATEST") CatalogSort sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return PageResponse.of(
                catalogService.list(q, sort, Math.max(0, page), clampSize(size)),
                CurriculumCardSummary::from);
    }

    @Operation(summary = "공개 커리큘럼 상세", description = "공개 커리큘럼 하나의 상세(강사·목차 포함). 없거나 비공개면 찾을 수 없음으로 응답한다.")
    @GetMapping("/api/curriculums/{curriculumId}")
    public CurriculumDetailResponse detail(@PathVariable UUID curriculumId) {
        return CurriculumDetailResponse.from(catalogService.detail(curriculumId));
    }

    /** 페이지 크기는 서버가 제한한다(CATALOG §4.1). 0 이하는 기본값, 상한 초과는 상한으로. */
    private int clampSize(int size) {
        if (size <= 0) {
            return DEFAULT_SIZE;
        }
        return Math.min(size, MAX_SIZE);
    }
}
