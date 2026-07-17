package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.InstructorCurriculumService;
import com.liveclass.curriculum.web.dto.CreateCurriculumRequest;
import com.liveclass.curriculum.web.dto.CurriculumResponse;
import com.liveclass.curriculum.web.dto.SectionRequest;
import com.liveclass.curriculum.web.dto.SectionResponse;
import com.liveclass.curriculum.web.dto.UpdateCurriculumRequest;
import com.liveclass.curriculum.web.dto.UpdateSectionRequest;
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
 * 강사용 커리큘럼·섹션 관리 (CONTRACT §2, 소유권 검증). 인가는 SecurityConfig가 ROLE_INSTRUCTOR로 건다.
 * 섹션은 커리큘럼 하위(생성·목록)와 단건(수정·삭제) 경로가 나뉜다 — 명세 URL 계열 확정본을 따른다.
 */
@Tag(name = "커리큘럼 관리(강사)", description = "커리큘럼·섹션 CRUD. 소유자만 접근 가능.")
@RestController
public class InstructorCurriculumController {

    private final InstructorCurriculumService service;

    public InstructorCurriculumController(InstructorCurriculumService service) {
        this.service = service;
    }

    @Operation(summary = "커리큘럼 생성", description = "DRAFT 상태로 생성한다.")
    @PostMapping("/api/instructor/curriculums")
    @ResponseStatus(HttpStatus.CREATED)
    public CurriculumResponse create(@Valid @RequestBody CreateCurriculumRequest request,
                                     Authentication authentication) {
        return CurriculumResponse.from(service.create(
                currentUserId(authentication), request.title(), request.summary(), request.description()));
    }

    @Operation(summary = "내 커리큘럼 목록", description = "생성 최신순.")
    @GetMapping("/api/instructor/curriculums")
    public List<CurriculumResponse> listMine(Authentication authentication) {
        return service.listMine(currentUserId(authentication)).stream()
                .map(CurriculumResponse::from)
                .toList();
    }

    @Operation(summary = "커리큘럼 관리 조회", description = "소유자만. 운영 카운터 포함.")
    @GetMapping("/api/instructor/curriculums/{curriculumId}")
    public CurriculumResponse get(@PathVariable UUID curriculumId, Authentication authentication) {
        return CurriculumResponse.from(service.getOwned(currentUserId(authentication), curriculumId));
    }

    @Operation(summary = "커리큘럼 기본 정보 수정", description = "넘어온 필드만 부분 수정.")
    @PatchMapping("/api/instructor/curriculums/{curriculumId}")
    public CurriculumResponse update(@PathVariable UUID curriculumId,
                                     @Valid @RequestBody UpdateCurriculumRequest request,
                                     Authentication authentication) {
        return CurriculumResponse.from(service.updateBasicInfo(
                currentUserId(authentication), curriculumId,
                request.title(), request.summary(), request.description()));
    }

    @Operation(summary = "섹션 목록", description = "순서 오름차순.")
    @GetMapping("/api/instructor/curriculums/{curriculumId}/sections")
    public List<SectionResponse> listSections(@PathVariable UUID curriculumId, Authentication authentication) {
        return service.listSections(currentUserId(authentication), curriculumId).stream()
                .map(SectionResponse::from)
                .toList();
    }

    @Operation(summary = "섹션 생성", description = "맨 뒤에 추가한다.")
    @PostMapping("/api/instructor/curriculums/{curriculumId}/sections")
    @ResponseStatus(HttpStatus.CREATED)
    public SectionResponse createSection(@PathVariable UUID curriculumId,
                                         @Valid @RequestBody SectionRequest request,
                                         Authentication authentication) {
        return SectionResponse.from(service.createSection(
                currentUserId(authentication), curriculumId, request.title(), request.description()));
    }

    @Operation(summary = "섹션 수정", description = "넘어온 필드만 부분 수정.")
    @PatchMapping("/api/instructor/sections/{sectionId}")
    public SectionResponse updateSection(@PathVariable UUID sectionId,
                                         @Valid @RequestBody UpdateSectionRequest request,
                                         Authentication authentication) {
        return SectionResponse.from(service.updateSection(
                currentUserId(authentication), sectionId, request.title(), request.description()));
    }

    @Operation(summary = "섹션 삭제", description = "레슨이 없는 섹션만 삭제할 수 있다.")
    @DeleteMapping("/api/instructor/sections/{sectionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteSection(@PathVariable UUID sectionId, Authentication authentication) {
        service.deleteSection(currentUserId(authentication), sectionId);
    }

    /** 인증 주체엔 사용자 ID(UUID 문자열)만 담겨 있다 — AuthController.establishSession 참고. */
    private UUID currentUserId(Authentication authentication) {
        return UUID.fromString(authentication.getName());
    }
}
