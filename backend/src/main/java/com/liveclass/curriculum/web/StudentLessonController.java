package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.CatalogService;
import com.liveclass.curriculum.web.dto.LessonDetailResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.UUID;

/**
 * 수강생용 레슨 상세 (LESSON-DETAIL-01). 강사용 {@code /api/instructor/lessons/{id}}와 달리
 * 소유권이 아니라 <b>수강 관계</b>로 연다.
 *
 * <p>경로가 {@code /api/instructor/**} 밖이라 SecurityConfig의 강사 전용 규칙에 걸리지 않고
 * {@code anyRequest().authenticated()}만 적용된다 — 그래서 누가 열 수 있는지는 서비스가 판정한다.
 * 손님(비로그인)은 여기까지 오지 못하므로 게이트는 수강 관계만 본다.
 */
@Tag(name = "레슨(수강생)", description = "수강 중인 커리큘럼의 레슨 상세를 연다.")
@RestController
public class StudentLessonController {

    private final CatalogService catalogService;

    public StudentLessonController(CatalogService catalogService) {
        this.catalogService = catalogService;
    }

    @Operation(summary = "레슨 상세",
            description = "레슨 하나의 상세를 반환한다. 소유 강사이거나 활성 수강생만 열 수 있고, "
                    + "수강 중이라도 아직 게시되지 않은 레슨은 찾을 수 없음으로 응답한다.")
    @GetMapping("/api/lessons/{lessonId}")
    public LessonDetailResponse get(@PathVariable UUID lessonId, Authentication authentication) {
        return LessonDetailResponse.from(
                catalogService.lessonDetail(lessonId, CatalogViewers.of(authentication)));
    }

    @Operation(summary = "레슨 자료 다운로드(수강생)",
            description = "활성 수강생에게만 자료의 presigned GET URL로 302 리다이렉트한다.")
    @GetMapping("/api/lessons/{lessonId}/materials/{materialId}/download")
    public ResponseEntity<Void> downloadMaterial(@PathVariable UUID lessonId,
                                                 @PathVariable UUID materialId,
                                                 Authentication authentication) {
        String url = catalogService.lessonMaterialDownloadUrl(
                lessonId, materialId, CatalogViewers.of(authentication));
        return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(url)).build();
    }
}
