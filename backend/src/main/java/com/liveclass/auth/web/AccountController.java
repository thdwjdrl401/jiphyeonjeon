package com.liveclass.auth.web;

import com.liveclass.auth.domain.AppUser;
import com.liveclass.auth.service.AuthService;
import com.liveclass.auth.web.dto.AuthUserResponse;
import com.liveclass.auth.web.dto.ChangePasswordRequest;
import com.liveclass.auth.web.dto.DisplayNameRequest;
import com.liveclass.auth.web.dto.InstructorProfileResponse;
import com.liveclass.auth.web.dto.ProfileImageRequest;
import com.liveclass.auth.web.dto.UpdateInstructorProfileRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * 내 계정 관리. 인증은 SecurityConfig의 anyRequest().authenticated()로 걸린다(로그인 필수).
 * /api/auth/* 와 경로 계열이 다르므로(/api/me) AuthController와 분리한다.
 */
@Tag(name = "내 계정", description = "로그인한 사용자가 자기 계정을 관리한다.")
@RestController
public class AccountController {

    private final AuthService authService;
    /**
     * principal 이름으로 세션을 찾아 지우는 인덱스 리포지토리. Spring Session이 <b>indexed 모드</b>일
     * 때만 빈으로 존재한다 — 지금은 non-indexed라 없다. 그래서 optional로 받고, 있으면 다른 기기
     * 세션까지 지운다. 없으면 현재 요청 세션만 무효화한다(대부분 자기 기기에서 탈퇴한다). 다중 기기
     * 완전 무효화는 indexed 세션 전환이 선행이며 별도 과제다(ADR-0031).
     */
    private final ObjectProvider<FindByIndexNameSessionRepository<? extends Session>> sessionRepositoryProvider;

    public AccountController(AuthService authService,
                             ObjectProvider<FindByIndexNameSessionRepository<? extends Session>> sessionRepositoryProvider) {
        this.authService = authService;
        this.sessionRepositoryProvider = sessionRepositoryProvider;
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

    @Operation(summary = "강사 공개 프로필 조회",
            description = "카탈로그 강사 소개에 노출되는 소개글·전문분야를 조회한다. 강사만.")
    @GetMapping("/api/me/instructor-profile")
    public InstructorProfileResponse getInstructorProfile(Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        return InstructorProfileResponse.from(authService.getInstructorProfile(userId));
    }

    @Operation(summary = "강사 공개 프로필 저장",
            description = "소개글·전문분야를 저장한다(없으면 생성). 강사만.")
    @PutMapping("/api/me/instructor-profile")
    public InstructorProfileResponse updateInstructorProfile(@Valid @RequestBody UpdateInstructorProfileRequest request,
                                                             Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        List<String> expertise = request.expertise() == null ? List.of() : request.expertise();
        return InstructorProfileResponse.from(
                authService.updateInstructorProfile(userId, request.bio(), expertise));
    }

    @Operation(summary = "비밀번호 변경",
            description = "현재 비밀번호가 맞아야 새 비밀번호로 바꾼다. 틀리면 401.")
    @PutMapping("/api/me/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(@Valid @RequestBody ChangePasswordRequest request,
                               Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        authService.changePassword(userId, request.currentPassword(), request.newPassword());
    }

    @Operation(summary = "회원 탈퇴",
            description = "계정을 탈퇴 처리한다(소프트 삭제). 진행 중인 라이브 강의가 있으면 409. "
                    + "탈퇴 후 세션이 즉시 파기되고, 같은 이메일로 다시 가입할 수 있다.")
    @DeleteMapping("/api/me")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void withdraw(Authentication authentication,
                         HttpServletRequest request, HttpServletResponse response) {
        UUID userId = UUID.fromString(authentication.getName());
        // 탈퇴가 성공(가드 통과)한 뒤에만 세션을 파기한다 — 진행 중 라이브로 409가 나면 세션은 유지돼야 한다.
        authService.withdraw(userId);
        destroyAllSessions(userId, request, response);
    }

    /**
     * 탈퇴자의 세션을 모두 없앤다. 현재 요청 세션은 SecurityContextLogoutHandler로 무효화하고(쿠키 정리 포함),
     * 다른 기기에 남은 세션은 Spring Session의 principal 인덱스로 찾아 지운다 — principal 이름은 userId다.
     */
    private void destroyAllSessions(UUID userId, HttpServletRequest request, HttpServletResponse response) {
        new SecurityContextLogoutHandler().logout(
                request, response, SecurityContextHolder.getContext().getAuthentication());
        FindByIndexNameSessionRepository<? extends Session> repo = sessionRepositoryProvider.getIfAvailable();
        if (repo != null) {
            repo.findByPrincipalName(userId.toString()).keySet().forEach(repo::deleteById);
        }
    }
}
