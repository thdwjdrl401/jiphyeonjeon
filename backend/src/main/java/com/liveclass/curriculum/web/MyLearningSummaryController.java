package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.CatalogService;
import com.liveclass.curriculum.web.dto.StudentLearningSummaryResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 학생 학습 요약(대시보드 상단). 목록(/me/enrollments)과 달리 활성 수강 전반의 합/평균을 준다.
 *
 * <p>수강·진도 집계라 curriculum이 조립을 맡는다({@link CatalogService}) — enrollment·learning·live 포트로만
 * 값을 얻어 순환 없이 채운다. 세션 사용자 기준(로그인 필요), 비학생/수강 없음은 빈 요약을 돌려준다.
 */
@Tag(name = "학습", description = "학생 학습 요약(대시보드)")
@RestController
public class MyLearningSummaryController {

    private final CatalogService catalogService;

    public MyLearningSummaryController(CatalogService catalogService) {
        this.catalogService = catalogService;
    }

    @Operation(summary = "내 학습 요약",
            description = "활성 수강 전반의 진행/완료 커리큘럼 수·평균 진도·완료 레슨 수와 다음 라이브 세션을 집계한다.")
    @GetMapping("/api/me/learning-summary")
    public StudentLearningSummaryResponse summary(Authentication authentication) {
        return StudentLearningSummaryResponse.from(
                catalogService.studentLearningSummary(CatalogViewers.of(authentication)));
    }
}
