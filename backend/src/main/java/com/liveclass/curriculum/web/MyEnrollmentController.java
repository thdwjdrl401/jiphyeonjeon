package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.CatalogService;
import com.liveclass.curriculum.web.dto.MyEnrollmentResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 내 수강 목록(학생).
 *
 * <p>수강 기록은 enrollment 모듈이 소유하지만, 목록 화면이 필요로 하는 커리큘럼 카드는 curriculum이
 * 소유한다. 두 모듈 사이에 순환 의존을 만들지 않기 위해 이미 enrollment를 참조하고 있는 curriculum이
 * 조립까지 맡는다 — 경로(/api/me/enrollments)는 그대로다.
 */
@Tag(name = "수강", description = "내 수강 목록")
@RestController
public class MyEnrollmentController {

    private final CatalogService catalogService;

    public MyEnrollmentController(CatalogService catalogService) {
        this.catalogService = catalogService;
    }

    @Operation(summary = "내 수강 목록", description = "내가 신청/수강한 커리큘럼 목록(최신순). 각 항목에 커리큘럼 카드가 함께 온다.")
    @GetMapping("/api/me/enrollments")
    public List<MyEnrollmentResponse> myEnrollments(Authentication authentication) {
        return catalogService.myEnrollments(CatalogViewers.of(authentication)).stream()
                .map(MyEnrollmentResponse::from).toList();
    }
}
