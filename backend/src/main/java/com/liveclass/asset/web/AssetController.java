package com.liveclass.asset.web;

import com.liveclass.asset.api.AssetRef;
import com.liveclass.asset.domain.AssetKind;
import com.liveclass.asset.service.AssetForbiddenException;
import com.liveclass.asset.service.AssetKindNotPublicException;
import com.liveclass.asset.service.AssetService;
import com.liveclass.asset.service.AssetUploadTicket;
import com.liveclass.asset.web.dto.UploadRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 에셋 업로드(presigned direct-to-storage). 인증은 SecurityConfig가 /api/assets/** 로 건다(로그인 필수).
 * kind별 세부 권한은 여기서 판정한다: THUMBNAIL은 강사만, PROFILE_IMAGE는 인증된 누구나, MATERIAL은 범위 밖.
 */
@Tag(name = "에셋 업로드", description = "presigned URL로 스토리지에 직접 올린다. 백엔드는 URL 발급과 완료 확인만 한다.")
@RestController
public class AssetController {

    private final AssetService assetService;

    public AssetController(AssetService assetService) {
        this.assetService = assetService;
    }

    @Operation(summary = "업로드 요청", description = "presigned PUT URL을 발급한다. 반환된 uploadUrl에 headers를 붙여 바이트를 직접 올린다.")
    @PostMapping("/api/assets/upload-requests")
    public AssetUploadTicket createUploadRequest(@Valid @RequestBody UploadRequest request,
                                                 Authentication authentication) {
        requireKindAllowed(request.kind(), authentication);
        return assetService.createUploadRequest(
                request.kind(), request.fileName(), request.contentType(), request.fileSize(),
                currentUserId(authentication));
    }

    @Operation(summary = "업로드 완료 통지", description = "스토리지 직접 업로드가 끝났음을 알린다. 서버가 실제 존재를 확인하고 UPLOADED로 전이한다.")
    @PostMapping("/api/assets/{assetId}/complete")
    public AssetRef complete(@PathVariable UUID assetId, Authentication authentication) {
        UUID requesterId = currentUserId(authentication);
        assetService.complete(assetId, requesterId);
        return assetService.find(assetId).orElseThrow();
    }

    /** kind 게이트: THUMBNAIL·MATERIAL은 강사만, PROFILE_IMAGE는 인증만으로 통과(ADR-0035). */
    private void requireKindAllowed(AssetKind kind, Authentication authentication) {
        if (kind == AssetKind.RECORDED_VIDEO_SOURCE) {
            throw new AssetKindNotPublicException("녹화강의 원본은 녹화강의 전용 API로만 업로드할 수 있습니다.");
        }
        if (kind == AssetKind.THUMBNAIL && !hasRole(authentication, "ROLE_INSTRUCTOR")) {
            throw new AssetForbiddenException("썸네일 업로드는 강사만 가능합니다.");
        }
        if (kind == AssetKind.MATERIAL && !hasRole(authentication, "ROLE_INSTRUCTOR")) {
            throw new AssetForbiddenException("자료 업로드는 강사만 가능합니다.");
        }
    }

    private boolean hasRole(Authentication authentication, String role) {
        return authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .anyMatch(role::equals);
    }

    private UUID currentUserId(Authentication authentication) {
        return UUID.fromString(authentication.getName());
    }
}
