package com.liveclass.auth.web;

import com.liveclass.auth.domain.AppUser;
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

import java.util.List;
import java.util.UUID;

/**
 * 인증 (CONTRACT §2, ADR-0014). 세션 본체는 Redis, 쿠키는 HttpOnly라 JS가 못 읽는다.
 * 경로에 버전 세그먼트를 두지 않는다 (ADR-0016).
 */
@Tag(name = "인증", description = "회원가입·로그인·세션. 쿠키 세션(Redis) 기반이며 Bearer 토큰을 쓰지 않는다 (ADR-0014).")
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final SecurityContextRepository securityContextRepository = new HttpSessionSecurityContextRepository();
    private final SecurityContextHolderStrategy securityContextHolderStrategy = SecurityContextHolder.getContextHolderStrategy();
    private final SessionAuthenticationStrategy sessionAuthenticationStrategy = new ChangeSessionIdAuthenticationStrategy();

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @Operation(summary = "CSRF 토큰 발급",
            description = "변경 요청 전에 호출한다. 응답의 token을 headerName(X-XSRF-TOKEN) 헤더로 에코해야 한다.")
    @GetMapping("/csrf")
    public CsrfResponse csrf(CsrfToken csrfToken) {
        return new CsrfResponse(csrfToken.getToken(), csrfToken.getHeaderName());
    }

    @Operation(summary = "회원가입", description = "가입은 세션을 만들지 않는다. 로그인은 별도로 호출해야 한다.")
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
        return AuthUserResponse.from(user);
    }

    @Operation(summary = "로그인", description = "성공 시 HttpOnly 세션 쿠키를 발급한다.")
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
        return AuthUserResponse.from(user);
    }

    @Operation(summary = "로그아웃", description = "세션을 무효화한다. 세션이 이미 없어도 성공(멱등)한다.")
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest request, HttpServletResponse response) {
        Authentication authentication = securityContextHolderStrategy.getContext().getAuthentication();
        new SecurityContextLogoutHandler().logout(request, response, authentication);
    }

    @Operation(summary = "현재 사용자 조회", description = "세션 쿠키로 인증된 사용자를 반환한다. 앱 시작·새로고침 시 복원용.")
    @ApiResponse(responseCode = "401", description = "세션 없음")
    @GetMapping("/me")
    public AuthUserResponse me(Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        return AuthUserResponse.from(authService.getById(userId));
    }

    @Operation(summary = "이메일 사용 가능 여부", description = "회원가입 전 이메일 중복 확인. 인증 불필요.")
    @GetMapping("/email-availability")
    public EmailAvailabilityResponse emailAvailability(@RequestParam @NotBlank String email) {
        return new EmailAvailabilityResponse(email, authService.isEmailAvailable(email));
    }

    /**
     * 인증 주체는 사용자 ID만 담는다. 표시 이름·역할을 세션에 복사해두면
     * 프로필이 바뀌었을 때 세션이 낡은 값을 들고 있게 되므로 조회 시점에 DB에서 읽는다.
     */
    private void establishSession(AppUser user, HttpServletRequest request, HttpServletResponse response) {
        Authentication authentication = UsernamePasswordAuthenticationToken.authenticated(
                user.getId().toString(),
                null,
                List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole().name()))
        );

        // 세션 고정 공격 방지: 인증 성공 시 세션 ID를 갈아끼운다.
        sessionAuthenticationStrategy.onAuthentication(authentication, request, response);

        SecurityContext context = securityContextHolderStrategy.createEmptyContext();
        context.setAuthentication(authentication);
        securityContextHolderStrategy.setContext(context);
        securityContextRepository.saveContext(context, request, response);
    }
}
