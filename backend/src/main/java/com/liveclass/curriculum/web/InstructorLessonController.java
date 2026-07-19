package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.InstructorCurriculumService;
import com.liveclass.curriculum.web.dto.CreateLessonRequest;
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
 * 검증 후 위임한다. 발행(READY→PUBLISHED)·자료(PPTX/AI)는 정책·파이프라인 미확정이라 범위 밖.
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

    private UUID currentUserId(Authentication authentication) {
        return UUID.fromString(authentication.getName());
    }
}
