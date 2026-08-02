package com.liveclass.auth.web;

import com.liveclass.auth.domain.AppUser;
import com.liveclass.auth.service.AdminAccounts;
import com.liveclass.auth.service.AuthService;
import com.liveclass.auth.web.dto.AuthUserResponse;
import com.liveclass.auth.web.dto.CsrfResponse;
import com.liveclass.auth.web.dto.EmailAvailabilityResponse;
import com.liveclass.auth.web.dto.LoginRequest;
import com.liveclass.auth.web.dto.SignupRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextHolderStrategy;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 인증 (CONTRACT §2, ADR-0014). 세션 본체는 Redis, 쿠키는 HttpOnly라 JS가 못 읽는다.
 * 경로에 버전 세그먼트를 두지 않는다 (ADR-0016).
 */
@Tag(name = "인증", description = "회원가입·로그인·로그아웃. 로그인하면 서버가 HttpOnly 쿠키에 세션을 담아주고, 이후 요청은 그 쿠키로 인증된다(토큰을 직접 들고 다니지 않음).")
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final AdminAccounts adminAccounts;
    private final SecurityContextRepository securityContextRepository = new HttpSessionSecurityContextRepository();
    private final SecurityContextHolderStrategy securityContextHolderStrategy = SecurityContextHolder.getContextHolderStrategy();
    private final SessionAuthenticationStrategy sessionAuthenticationStrategy = new ChangeSessionIdAuthenticationStrategy();

    public AuthController(AuthService authService, AdminAccounts adminAccounts) {
        this.authService = authService;
        this.adminAccounts = adminAccounts;
    }

    @Operation(summary = "CSRF 토큰 발급",
            description = "데이터를 바꾸는 요청(로그인·회원가입 등 POST/PATCH/DELETE)을 보내기 전에 먼저 호출한다. "
                    + "응답으로 받은 token 값을, 함께 온 headerName 이름의 HTTP 헤더에 담아 그다음 요청에 붙여야 한다.")
    @GetMapping("/csrf")
    public CsrfResponse csrf(CsrfToken csrfToken) {
        return new CsrfResponse(csrfToken.getToken(), csrfToken.getHeaderName());
    }

    @Operation(summary = "회원가입", description = "새 계정을 만든다. 가입만으로는 로그인되지 않으니, 로그인을 따로 호출해야 한다.")
    @ApiResponses({
            @ApiResponse(responseCode = "201", description = "생성됨"),
            @ApiResponse(responseCode = "400", description = "입력 검증 실패 (VALIDATION_FAILED)"),
            @ApiResponse(responseCode = "409", description = "이메일 중복 (AUTH_EMAIL_DUPLICATED)")
    })
    @PostMapping("/signup")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthUserResponse signup(@Valid @RequestBody SignupRequest request) {
        AppUser user = authService.signup(
                request.email(),
                request.password(),
                request.displayName(),
                request.role().toRole()
        );
        return AuthUserResponse.from(user, null, adminAccounts.isAdmin(user.getEmail()));
    }

    @Operation(summary = "로그인", description = "이메일·비밀번호로 로그인한다. 성공하면 세션 쿠키가 발급돼 이후 요청이 자동으로 인증된다.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "로그인 성공, 세션 쿠키 발급"),
            @ApiResponse(responseCode = "401", description = "자격 증명 실패 (AUTH_INVALID_CREDENTIALS)")
    })
    @PostMapping("/login")
    public AuthUserResponse login(
            @Valid @RequestBody LoginRequest request,
            HttpServletRequest httpRequest,
            HttpServletResponse httpResponse
    ) {
        AppUser user = authService.authenticate(request.email(), request.password());
        establishSession(user, httpRequest, httpResponse);
        return AuthUserResponse.from(user, null, adminAccounts.isAdmin(user.getEmail()));
    }

    @Operation(summary = "로그아웃", description = "로그아웃한다. 이미 로그아웃 상태여도 정상 성공으로 처리된다.")
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest request, HttpServletResponse response) {
        Authentication authentication = securityContextHolderStrategy.getContext().getAuthentication();
        new SecurityContextLogoutHandler().logout(request, response, authentication);
    }

    @Operation(summary = "현재 사용자 조회", description = "지금 로그인된 사용자 정보를 반환한다. 앱을 처음 열거나 새로고침할 때 로그인 상태를 복원하는 데 쓴다.")
    @ApiResponse(responseCode = "401", description = "세션 없음")
    @GetMapping("/me")
    public AuthUserResponse me(Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        AppUser user = authService.getById(userId);
        return AuthUserResponse.from(user, authService.resolveProfileImageUrl(user), adminAccounts.isAdmin(user.getEmail()));
    }

    @Operation(summary = "이메일 사용 가능 여부", description = "회원가입 화면에서 이 이메일이 이미 쓰이는지 확인한다. 로그인 없이 호출할 수 있다.")
    @GetMapping("/email-availability")
    public EmailAvailabilityResponse emailAvailability(@RequestParam @NotBlank String email) {
        return new EmailAvailabilityResponse(email, authService.isEmailAvailable(email));
    }

    /**
     * 인증 주체는 사용자 ID만 담는다. 표시 이름·역할을 세션에 복사해두면
     * 프로필이 바뀌었을 때 세션이 낡은 값을 들고 있게 되므로 조회 시점에 DB에서 읽는다.
     */
    private void establishSession(AppUser user, HttpServletRequest request, HttpServletResponse response) {
        // 기본 권한은 계정 역할(ROLE_STUDENT/INSTRUCTOR). 관리자 allowlist에 든 이메일이면 ROLE_ADMIN을
        // 덧입힌다(AdminAccounts) — 별도 회원가입 역할 없이 운영 도구(Egress 콘솔 등)를 게이팅한다.
        List<GrantedAuthority> authorities = new ArrayList<>();
        authorities.add(new SimpleGrantedAuthority("ROLE_" + user.getRole().name()));
        if (adminAccounts.isAdmin(user.getEmail())) {
            authorities.add(new SimpleGrantedAuthority("ROLE_ADMIN"));
        }
        Authentication authentication = UsernamePasswordAuthenticationToken.authenticated(
                user.getId().toString(),
                null,
                authorities
        );

        // 세션 고정 공격 방지: 인증 성공 시 세션 ID를 갈아끼운다.
        sessionAuthenticationStrategy.onAuthentication(authentication, request, response);

        SecurityContext context = securityContextHolderStrategy.createEmptyContext();
        context.setAuthentication(authentication);
        securityContextHolderStrategy.setContext(context);
        securityContextRepository.saveContext(context, request, response);
    }
}
