package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.InstructorCurriculumService;
import com.liveclass.curriculum.web.dto.AttachMaterialRequest;
import com.liveclass.curriculum.web.dto.CreateLessonRequest;
import com.liveclass.curriculum.web.dto.LessonMaterialResponse;
import com.liveclass.curriculum.web.dto.UpdateLessonRequest;
import com.liveclass.lesson.api.LessonView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * 강사용 레슨 관리 (CONTRACT §2, 소유권 검증). 데이터는 lesson 모듈이 소유하고, 여기선 소유권
 * 검증 후 위임한다. 발행/게시취소는 MVP 직행 DRAFT↔PUBLISHED command다(ADR-0021) — AI 준비도
 * 게이팅(READY→PUBLISHED)은 CP2로 유보. 자료(PPTX/AI) 파이프라인은 여전히 범위 밖.
 */
@Tag(name = "레슨 관리(강사)", description = "강사가 섹션 안의 레슨을 만들고 수정한다. 본인 커리큘럼의 레슨만 접근할 수 있다.")
@RestController
public class InstructorLessonController {

    private final InstructorCurriculumService service;

    public InstructorLessonController(InstructorCurriculumService service) {
        this.service = service;
    }

    @Operation(summary = "레슨 생성", description = "섹션 맨 뒤에 새 레슨을 추가한다. 처음엔 초안 상태다.")
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

    @Operation(summary = "레슨 조회", description = "레슨 하나의 상세를 반환한다. 본인 것만.")
    @GetMapping("/api/instructor/lessons/{lessonId}")
    public LessonView get(@PathVariable UUID lessonId, Authentication authentication) {
        return service.getLesson(currentUserId(authentication), lessonId);
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

    @Operation(summary = "레슨 발행", description = "레슨을 PUBLISHED로 바꿔 공개 목차에 노출한다. MVP 직행(DRAFT→PUBLISHED).")
    @PostMapping("/api/instructor/lessons/{lessonId}/publish")
    public LessonView publish(@PathVariable UUID lessonId, Authentication authentication) {
        return service.publishLesson(currentUserId(authentication), lessonId);
    }

    @Operation(summary = "레슨 게시취소", description = "레슨을 DRAFT로 되돌려 공개 목차에서 내린다(PUBLISHED→DRAFT).")
    @PostMapping("/api/instructor/lessons/{lessonId}/unpublish")
    public LessonView unpublish(@PathVariable UUID lessonId, Authentication authentication) {
        return service.unpublishLesson(currentUserId(authentication), lessonId);
    }

    @Operation(summary = "레슨 자료 연결",
            description = "미리 업로드한 자료 에셋(kind=MATERIAL)을 레슨에 연결한다. 본문의 assetId는 "
                    + "본인이 올린 업로드 완료 에셋이어야 한다(ADR-0034). 파일 바이트는 presigned로 이미 올라가 있다.")
    @PostMapping("/api/instructor/lessons/{lessonId}/materials")
    @ResponseStatus(HttpStatus.CREATED)
    public LessonMaterialResponse attachMaterial(@PathVariable UUID lessonId,
                                                 @Valid @RequestBody AttachMaterialRequest request,
                                                 Authentication authentication) {
        return LessonMaterialResponse.from(
                service.attachMaterial(currentUserId(authentication), lessonId, request.assetId()));
    }

    private UUID currentUserId(Authentication authentication) {
        return UUID.fromString(authentication.getName());
    }
}
