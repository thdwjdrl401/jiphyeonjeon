package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.CatalogService;
import com.liveclass.curriculum.web.dto.InstructorDashboardSummaryResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 강사 대시보드 요약(내 커리큘럼 상단). 학생 요약({@code /me/learning-summary})의 강사판 —
 * 운영 지표(커리큘럼 수·공개 수·예정 라이브·수강생 합)와 다음 라이브를 집계한다.
 *
 * <p>수강·라이브·레슨 집계라 curriculum이 조립을 맡는다({@link CatalogService}) — 각 포트로만 값을
 * 얻어 순환 없이 채운다. {@code /api/instructor/**}라 INSTRUCTOR 역할 필수(SecurityConfig).
 */
@Tag(name = "강사 대시보드", description = "강사 운영 요약(대시보드)")
@RestController
public class InstructorDashboardController {

    private final CatalogService catalogService;

    public InstructorDashboardController(CatalogService catalogService) {
        this.catalogService = catalogService;
    }

    @Operation(summary = "강사 대시보드 요약",
            description = "내 커리큘럼 수·공개 커리큘럼 수·예정 라이브 수·전체 수강생 합과 다음 라이브 세션을 집계한다.")
    @GetMapping("/api/instructor/dashboard-summary")
    public InstructorDashboardSummaryResponse summary(Authentication authentication) {
        return InstructorDashboardSummaryResponse.from(
                catalogService.instructorDashboardSummary(CatalogViewers.of(authentication)));
    }
}
