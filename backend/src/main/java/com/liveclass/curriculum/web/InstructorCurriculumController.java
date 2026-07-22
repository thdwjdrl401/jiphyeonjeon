package com.liveclass.curriculum.web;

import com.liveclass.asset.api.AssetDirectory;
import com.liveclass.curriculum.domain.Curriculum;
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
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * 강사용 커리큘럼·섹션 관리 (CONTRACT §2, 소유권 검증). 인가는 SecurityConfig가 ROLE_INSTRUCTOR로 건다.
 * 섹션은 커리큘럼 하위(생성·목록)와 단건(수정·삭제) 경로가 나뉜다 — 명세 URL 계열 확정본을 따른다.
 */
@Tag(name = "커리큘럼 관리(강사)", description = "강사가 자기 커리큘럼과 그 안의 섹션(목차)을 만들고 수정한다. 본인 것만 접근할 수 있다.")
@RestController
public class InstructorCurriculumController {

    private final InstructorCurriculumService service;
    private final AssetDirectory assetDirectory;

    public InstructorCurriculumController(InstructorCurriculumService service, AssetDirectory assetDirectory) {
        this.service = service;
        this.assetDirectory = assetDirectory;
    }

    @Operation(summary = "커리큘럼 생성", description = "새 커리큘럼을 만든다. 처음엔 비공개(초안) 상태이고, 발행해야 공개 카탈로그에 노출된다.")
    @PostMapping("/api/instructor/curriculums")
    @ResponseStatus(HttpStatus.CREATED)
    public CurriculumResponse create(@Valid @RequestBody CreateCurriculumRequest request,
                                     Authentication authentication) {
        return toResponse(service.create(
                currentUserId(authentication), request.title(), request.summary(), request.description(),
                request.thumbnailAssetId()));
    }

    @Operation(summary = "내 커리큘럼 목록", description = "내가 만든 커리큘럼 목록을 최근 만든 순으로 반환한다.")
    @GetMapping("/api/instructor/curriculums")
    public List<CurriculumResponse> listMine(Authentication authentication) {
        List<Curriculum> curriculums = service.listMine(currentUserId(authentication));
        // 썸네일 URL은 목록 크기만큼 배치로 해석해 N+1을 피한다.
        Map<UUID, String> urls = assetDirectory.resolveUrls(curriculums.stream()
                .map(Curriculum::getThumbnailAssetId).filter(Objects::nonNull).toList());
        return curriculums.stream()
                .map(c -> CurriculumResponse.from(c, thumbnailUrl(c, urls)))
                .toList();
    }

    @Operation(summary = "커리큘럼 관리 조회", description = "관리 화면용 상세. 섹션·레슨 개수 같은 운영 정보까지 포함한다. 본인 것만.")
    @GetMapping("/api/instructor/curriculums/{curriculumId}")
    public CurriculumResponse get(@PathVariable UUID curriculumId, Authentication authentication) {
        return toResponse(service.getOwned(currentUserId(authentication), curriculumId));
    }

    @Operation(summary = "커리큘럼 기본 정보 수정", description = "제목·소개·설명·진행 기간·썸네일을 수정한다. 요청에 담아 보낸 필드만 바뀐다.")
    @PatchMapping("/api/instructor/curriculums/{curriculumId}")
    public CurriculumResponse update(@PathVariable UUID curriculumId,
                                     @Valid @RequestBody UpdateCurriculumRequest request,
                                     Authentication authentication) {
        return toResponse(service.updateBasicInfo(
                currentUserId(authentication), curriculumId,
                request.title(), request.summary(), request.description(),
                request.startsAt(), request.endsAt(), request.thumbnailAssetId()));
    }

    @Operation(summary = "커리큘럼 발행", description = "커리큘럼을 공개한다. 공개되는 즉시 카탈로그에 노출된다. 초안(비공개) 상태일 때만 발행할 수 있다.")
    @PostMapping("/api/instructor/curriculums/{curriculumId}/publish")
    public CurriculumResponse publish(@PathVariable UUID curriculumId, Authentication authentication) {
        return toResponse(service.publish(currentUserId(authentication), curriculumId));
    }

    @Operation(summary = "커리큘럼 보관", description = "공개된 커리큘럼을 내린다. 카탈로그에서 사라진다. 현재 공개 상태일 때만 보관할 수 있다.")
    @PostMapping("/api/instructor/curriculums/{curriculumId}/archive")
    public CurriculumResponse archive(@PathVariable UUID curriculumId, Authentication authentication) {
        return toResponse(service.archive(currentUserId(authentication), curriculumId));
    }

    @Operation(summary = "섹션 목록", description = "커리큘럼의 섹션(목차)을 배치 순서대로 반환한다.")
    @GetMapping("/api/instructor/curriculums/{curriculumId}/sections")
    public List<SectionResponse> listSections(@PathVariable UUID curriculumId, Authentication authentication) {
        return service.listSections(currentUserId(authentication), curriculumId).stream()
                .map(SectionResponse::from)
                .toList();
    }

    @Operation(summary = "섹션 생성", description = "새 섹션을 목차 맨 뒤에 추가한다.")
    @PostMapping("/api/instructor/curriculums/{curriculumId}/sections")
    @ResponseStatus(HttpStatus.CREATED)
    public SectionResponse createSection(@PathVariable UUID curriculumId,
                                         @Valid @RequestBody SectionRequest request,
                                         Authentication authentication) {
        return SectionResponse.from(service.createSection(
                currentUserId(authentication), curriculumId, request.title(), request.description()));
    }

    @Operation(summary = "섹션 수정", description = "섹션 제목·설명을 수정한다. 보낸 필드만 바뀐다.")
    @PatchMapping("/api/instructor/sections/{sectionId}")
    public SectionResponse updateSection(@PathVariable UUID sectionId,
                                         @Valid @RequestBody UpdateSectionRequest request,
                                         Authentication authentication) {
        return SectionResponse.from(service.updateSection(
                currentUserId(authentication), sectionId, request.title(), request.description()));
    }

    @Operation(summary = "섹션 삭제", description = "섹션을 삭제한다. 안에 레슨이 남아 있으면 삭제할 수 없다(먼저 레슨을 비워야 한다).")
    @DeleteMapping("/api/instructor/sections/{sectionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteSection(@PathVariable UUID sectionId, Authentication authentication) {
        service.deleteSection(currentUserId(authentication), sectionId);
    }

    /** 단건 응답: 썸네일 에셋이 있으면 presigned URL로 해석해 채운다(없으면 null). */
    private CurriculumResponse toResponse(Curriculum c) {
        String url = c.getThumbnailAssetId() == null
                ? null
                : assetDirectory.resolveUrl(c.getThumbnailAssetId()).orElse(null);
        return CurriculumResponse.from(c, url);
    }

    private String thumbnailUrl(Curriculum c, Map<UUID, String> urls) {
        return c.getThumbnailAssetId() == null ? null : urls.get(c.getThumbnailAssetId());
    }

    /** 인증 주체엔 사용자 ID(UUID 문자열)만 담겨 있다 — AuthController.establishSession 참고. */
    private UUID currentUserId(Authentication authentication) {
        return UUID.fromString(authentication.getName());
    }
}
