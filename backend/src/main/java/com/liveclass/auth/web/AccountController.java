package com.liveclass.auth.web;

import com.liveclass.auth.domain.AppUser;
import com.liveclass.auth.service.AuthService;
import com.liveclass.auth.web.dto.AuthUserResponse;
import com.liveclass.auth.web.dto.DisplayNameRequest;
import com.liveclass.auth.web.dto.ProfileImageRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 내 계정(프로필) 관리. 인증은 SecurityConfig의 anyRequest().authenticated()로 걸린다(로그인 필수).
 * /api/auth/* 와 경로 계열이 다르므로(/api/me) AuthController와 분리한다.
 */
@Tag(name = "내 계정", description = "로그인한 사용자가 자기 프로필을 관리한다.")
@RestController
public class AccountController {

    private final AuthService authService;

    public AccountController(AuthService authService) {
        this.authService = authService;
    }

    @Operation(summary = "프로필 이미지 설정",
            description = "미리 업로드 완료한 본인 PROFILE_IMAGE 에셋을 프로필 이미지로 지정한다.")
    @PutMapping("/api/me/profile-image")
    public AuthUserResponse updateProfileImage(@Valid @RequestBody ProfileImageRequest request,
                                               Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        AppUser user = authService.updateProfileImage(userId, request.assetId());
        return AuthUserResponse.from(user, authService.resolveProfileImageUrl(user));
    }

    @Operation(summary = "표시 이름 변경",
            description = "화면에 보이는 이름을 바꾼다. 로그인 식별자(email)는 바뀌지 않는다.")
    @PutMapping("/api/me/display-name")
    public AuthUserResponse updateDisplayName(@Valid @RequestBody DisplayNameRequest request,
                                              Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        AppUser user = authService.updateDisplayName(userId, request.displayName());
        return AuthUserResponse.from(user, authService.resolveProfileImageUrl(user));
    }
}
