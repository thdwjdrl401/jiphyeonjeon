package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.InstructorCurriculumService;
import com.liveclass.curriculum.web.dto.AttachMaterialRequest;
import com.liveclass.curriculum.web.dto.CreateLessonRequest;
import com.liveclass.curriculum.web.dto.InstructorLessonResponse;
import com.liveclass.curriculum.web.dto.LessonMaterialResponse;
import com.liveclass.curriculum.web.dto.UpdateLessonRequest;
import com.liveclass.lesson.api.LessonView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;
import java.util.UUID;

/**
 * 강사용 레슨 관리 (CONTRACT §2, 소유권 검증). 데이터는 lesson 모듈이 소유하고, 여기선 소유권
 * 검증 후 위임한다. CRUD는 생성·수정·삭제뿐이다 — 발행/게시취소 command는 없다(ADR-0005).
 * 자료(PPTX/AI) 파이프라인은 범위 밖.
 */
@Tag(name = "레슨 관리(강사)", description = "강사가 섹션 안의 레슨을 만들고 수정한다. 본인 커리큘럼의 레슨만 접근할 수 있다.")
@RestController
public class InstructorLessonController {

    private final InstructorCurriculumService service;

    public InstructorLessonController(InstructorCurriculumService service) {
        this.service = service;
    }

    @Operation(summary = "레슨 생성", description = "섹션 맨 뒤에 새 레슨을 추가한다. 만들어지는 순간 게시 상태이며, 외부 공개는 커리큘럼 발행이 결정한다.")
    @PostMapping("/api/instructor/sections/{sectionId}/lessons")
    @ResponseStatus(HttpStatus.CREATED)
    public LessonView create(@PathVariable UUID sectionId,
                             @Valid @RequestBody CreateLessonRequest request,
                             Authentication authentication) {
        return service.createLesson(currentUserId(authentication), sectionId, request.title(), request.description());
    }

    @Operation(summary = "레슨 목록", description = "섹션 안의 레슨을 배치 순서대로 반환한다.")
    @GetMapping("/api/instructor/sections/{sectionId}/lessons")
    public List<LessonView> list(@PathVariable UUID sectionId, Authentication authentication) {
        return service.listLessons(currentUserId(authentication), sectionId);
    }

    @Operation(summary = "레슨 조회", description = "레슨 하나의 상세를 반환한다. 본인 것만. 연결된 활성 자료(materials)를 함께 준다(ADR-0035).")
    @GetMapping("/api/instructor/lessons/{lessonId}")
    public InstructorLessonResponse get(@PathVariable UUID lessonId, Authentication authentication) {
        return InstructorLessonResponse.from(service.getLessonDetail(currentUserId(authentication), lessonId));
    }

    @Operation(summary = "레슨 수정", description = "레슨 제목·설명을 수정한다. 보낸 필드만 바뀐다.")
    @PatchMapping("/api/instructor/lessons/{lessonId}")
    public LessonView update(@PathVariable UUID lessonId,
                             @Valid @RequestBody UpdateLessonRequest request,
                             Authentication authentication) {
        return service.updateLesson(currentUserId(authentication), lessonId, request.title(), request.description());
    }

    @Operation(summary = "레슨 삭제", description = "레슨을 삭제한다.")
    @DeleteMapping("/api/instructor/lessons/{lessonId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID lessonId, Authentication authentication) {
        service.deleteLesson(currentUserId(authentication), lessonId);
    }

    // 레슨 발행·게시취소 엔드포인트는 없다 — 레슨은 만들어지는 순간 게시 상태이고 되돌릴 상태가
    // 없다. 공개 여부는 커리큘럼 발행(POST /instructor/curriculums/{id}/publish)이 결정한다(ADR-0005).

    @Operation(summary = "레슨 자료 연결",
            description = "미리 업로드한 자료 에셋(kind=MATERIAL)을 레슨에 연결한다. 본문의 assetId는 "
                    + "본인이 올린 업로드 완료 에셋이어야 한다(ADR-0035). 파일 바이트는 presigned로 이미 올라가 있다.")
    @PostMapping("/api/instructor/lessons/{lessonId}/materials")
    @ResponseStatus(HttpStatus.CREATED)
    public LessonMaterialResponse attachMaterial(@PathVariable UUID lessonId,
                                                 @Valid @RequestBody AttachMaterialRequest request,
                                                 Authentication authentication) {
        return LessonMaterialResponse.from(
                service.attachMaterial(currentUserId(authentication), lessonId, request.assetId()));
    }

    @Operation(summary = "레슨 자료 삭제", description = "연결된 자료를 소프트 삭제한다(멱등). 소유 강사만.")
    @DeleteMapping("/api/instructor/lessons/{lessonId}/materials/{materialId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteMaterial(@PathVariable UUID lessonId, @PathVariable UUID materialId,
                               Authentication authentication) {
        service.detachMaterial(currentUserId(authentication), lessonId, materialId);
    }

    @Operation(summary = "레슨 자료 다운로드",
            description = "presigned GET URL로 302 리다이렉트한다 — 바이트는 스토리지 직결(앱 서버를 통과하지 않음). 소유 강사만.")
    @GetMapping("/api/instructor/lessons/{lessonId}/materials/{materialId}/download")
    public ResponseEntity<Void> downloadMaterial(@PathVariable UUID lessonId, @PathVariable UUID materialId,
                                                 Authentication authentication) {
        String url = service.materialDownloadUrl(currentUserId(authentication), lessonId, materialId);
        return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(url)).build();
    }

    private UUID currentUserId(Authentication authentication) {
        return UUID.fromString(authentication.getName());
    }
}
