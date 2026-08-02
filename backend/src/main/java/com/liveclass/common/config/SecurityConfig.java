package com.liveclass.common.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.DelegatingPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;

import java.util.Map;

/**
 * 인증 = HttpOnly 쿠키 + Redis 세션 (ADR-0014).
 */
@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                // SPA용 CSRF: JS가 XSRF-TOKEN 쿠키를 읽어 헤더로 에코 (ADR-0014)
                // LiveKit webhook은 외부 서버 호출이라 CSRF 토큰이 없다 — JWT 서명으로 인증하므로 면제한다.
                .csrf(csrf -> csrf.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                        .ignoringRequestMatchers("/api/webhooks/**", "/api/internal/**"))
                .authorizeHttpRequests(auth -> auth
                        // 오류는 서블릿이 /error 로 포워딩한다. 이걸 막으면 404·500이 전부 401로 위장돼
                        // 프론트가 "로그아웃됐다"고 오해한다(client.ts는 401에서 CSRF 캐시를 버린다).
                        .requestMatchers("/error").permitAll()
                        // API 문서(springdoc). 운영 노출 범위는 후속에서 프로파일로 조일 수 있다.
                        .requestMatchers("/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").permitAll()
                        .requestMatchers("/actuator/health").permitAll()
                        // Prometheus 스크레이프 대상(세션 없이 접근). 메트릭(JVM·요청통계) 노출이라
                        // 운영 배포 전엔 별도 관리 포트(management.server.port)나 네트워크 ACL로 제한할 것.
                        .requestMatchers("/actuator/prometheus").permitAll()
                        // 로그인 전에 부를 수 있어야 하는 것들 — csrf가 막히면 로그인 자체가 불가능하다.
                        .requestMatchers(HttpMethod.GET, "/api/auth/csrf", "/api/auth/email-availability").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/signup", "/api/auth/login", "/api/auth/logout").permitAll()
                        // LiveKit egress webhook — 로그인 세션이 아니라 JWT 서명으로 인증한다(컨트롤러가 검증).
                        .requestMatchers(HttpMethod.POST, "/api/webhooks/livekit").permitAll()
                        // AI 워커 콜백·자료 URL 발급 — 로그인 세션 아니라 HMAC 서명으로 인증한다(AiCallbackVerifier). ADR-0036.
                        .requestMatchers(HttpMethod.POST, "/api/internal/ai/callbacks").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/internal/ai/materials/download-url").permitAll()
                        // 판서 문서 조회 — Egress(헤드리스 Chrome)는 세션 쿠키가 없고 LiveKit 토큰만
                        // 갖고 있다. 그 토큰 서명과 방 이름을 컨트롤러가 검증한다(ADR-0055).
                        // 세션이 있으면 참가자 게이트를, 없으면 토큰을 본다 — 둘 중 하나는 반드시 통과해야 한다.
                        // 쓰기(POST .../annotation/ops)는 여기 열지 않는다: 방에 들어올 수 있다는 것과
                        // 문서를 고칠 수 있다는 것은 다르다.
                        .requestMatchers(HttpMethod.GET, "/api/live-sessions/*/annotation").permitAll()
                        // 판서 해석 이미지 — 받아가는 쪽이 모델 제공자의 서버라 우리 인증 주체가
                        // 아니다(ADR-0058). 토큰 자체가 자격이고, 128비트 난수 + 짧은 TTL +
                        // 호출 종료 시 즉시 폐기로 노출 창을 좁힌다.
                        .requestMatchers(HttpMethod.GET, "/api/annotation-interpret-images/*").permitAll()
                        // 공개 카탈로그 조회는 비로그인도 가능(GET만).
                        .requestMatchers(HttpMethod.GET, "/api/curriculums", "/api/curriculums/**").permitAll()
                        // 수강 신청·취소는 학생만(강사 계정은 수강 불가 — 계정 분리 정책). 강사 승인 등은 /api/instructor/**.
                        .requestMatchers(HttpMethod.POST, "/api/curriculums/*/enrollments").hasRole("STUDENT")
                        .requestMatchers(HttpMethod.DELETE, "/api/curriculums/*/enrollments/me").hasRole("STUDENT")
                        // 강사 관리 API는 INSTRUCTOR 역할 필수. 소유권(내 커리큘럼인가)은 서비스가 별도로 검증한다.
                        .requestMatchers("/api/instructor/**").hasRole("INSTRUCTOR")
                        // 운영 관리 API(Egress 콘솔 등)는 ADMIN 전용. ADMIN은 security.admin-emails allowlist로
                        // 로그인 시 오버레이되는 권한이다(AdminAccounts) — 별도 회원가입 역할이 아니다.
                        .requestMatchers("/api/admin/**").hasRole("ADMIN")
                        // 에셋 업로드는 로그인 필수(익명 발급 금지). kind별 세부 권한(THUMBNAIL=강사)은
                        // 컨트롤러가 판정한다. anyRequest().authenticated()로도 덮이지만 의도를 못박아 둔다.
                        .requestMatchers("/api/assets/**").authenticated()
                        .anyRequest().authenticated()
                )
                // 기본 동작은 403이지만 CONTRACT §2는 인증 실패를 401로 못박았다.
                .exceptionHandling(ex -> ex.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)));
        return http.build();
    }

    /**
     * {bcrypt} 접두사를 붙여 저장 → 나중에 해시 알고리즘을 바꿔도 기존 행을 읽을 수 있다.
     *
     * <p>강도를 프로퍼티로 뺀 이유는 <b>테스트 속도</b>다. BCrypt는 일부러 느리게 설계됐고 기본 강도 10은
     * encode+match 한 쌍에 약 100ms다. 계약 테스트가 매번 회원가입·로그인을 실제로 태우므로 호출이
     * 371번 쌓이고, 그것만으로 스위트 실행의 <b>약 40초(전체의 1/4)</b>가 해시 계산에 쓰인다. 테스트
     * 컨텍스트에서만 최소 강도로 낮춰 그 시간을 돌려받는다 — 운영 기본값 10은 그대로다.
     *
     * <p>{@code createDelegatingPasswordEncoder()}는 강도를 지정할 수 없어 직접 구성한다. 저장 형식은
     * 그대로 {@code {bcrypt}$2a$<강도>$...}이고 DelegatingPasswordEncoder가 접두사로 검증기를 고르므로
     * <b>이미 저장된 해시도 그대로 검증된다</b>(강도는 해시 문자열에 박혀 있다). 운영 DB의 기존 해시가
     * 전부 {@code {bcrypt}} 접두사임을 확인하고 바꿨다.
     */
    @Bean
    public PasswordEncoder passwordEncoder(
            @Value("${liveclass.security.bcrypt-strength:10}") int bcryptStrength) {
        String encodingId = "bcrypt";
        return new DelegatingPasswordEncoder(encodingId,
                Map.of(encodingId, new BCryptPasswordEncoder(bcryptStrength)));
    }
}
