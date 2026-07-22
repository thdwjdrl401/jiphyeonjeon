package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.CatalogService;
import com.liveclass.curriculum.service.CatalogSort;
import com.liveclass.curriculum.web.dto.CurriculumCardSummary;
import com.liveclass.curriculum.web.dto.CurriculumDetailResponse;
import com.liveclass.curriculum.web.dto.PageResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 공개 커리큘럼 탐색 (CATALOG-01, CURRICULUM-DETAIL-01). 비로그인도 호출 가능.
 *
 * <p>로그인 쿠키가 있으면 그 사용자 기준으로 viewerContext(관계·가능한 행동)를 함께 채운다.
 * 경로 자체는 permitAll이라 {@link Authentication}이 null이거나 익명일 수 있고, 그 경우 손님으로 본다.
 */
@Tag(name = "카탈로그(공개)", description = "누구나(로그인 없이) 공개된 커리큘럼을 검색하고 열어볼 수 있는 조회 API.")
@RestController
public class CatalogController {

    private final CatalogService catalogService;

    public CatalogController(CatalogService catalogService) {
        this.catalogService = catalogService;
    }

    @Operation(summary = "공개 커리큘럼 목록", description = "공개된 커리큘럼을 검색·정렬·페이지로 조회한다. q로 제목·소개를 검색할 수 있다. 로그인 상태면 카드마다 내 관계(viewerContext)가 함께 온다.")
    @GetMapping("/api/curriculums")
    public PageResponse<CurriculumCardSummary> list(
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "LATEST") CatalogSort sort,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            Authentication authentication
    ) {
        int pageSize = PageParams.size(size);
        return PageResponse.of(
                catalogService.list(q, sort, PageParams.page(page, pageSize), pageSize,
                        CatalogViewers.of(authentication)),
                CurriculumCardSummary::from);
    }

    @Operation(summary = "공개 커리큘럼 상세", description = "공개 커리큘럼 하나의 상세(강사·목차·내 관계 포함). 없거나 비공개면 찾을 수 없음으로 응답한다.")
    @GetMapping("/api/curriculums/{curriculumId}")
    public CurriculumDetailResponse detail(@PathVariable UUID curriculumId, Authentication authentication) {
        return CurriculumDetailResponse.from(catalogService.detail(curriculumId, CatalogViewers.of(authentication)));
    }

}
