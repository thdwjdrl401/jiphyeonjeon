package com.liveclass.common.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;

/**
 * 인증 = HttpOnly 쿠키 + Redis 세션 (ADR-0014).
 */
@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                // SPA용 CSRF: JS가 XSRF-TOKEN 쿠키를 읽어 헤더로 에코 (ADR-0014)
                .csrf(csrf -> csrf.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse()))
                .authorizeHttpRequests(auth -> auth
                        // 오류는 서블릿이 /error 로 포워딩한다. 이걸 막으면 404·500이 전부 401로 위장돼
                        // 프론트가 "로그아웃됐다"고 오해한다(client.ts는 401에서 CSRF 캐시를 버린다).
                        .requestMatchers("/error").permitAll()
                        // API 문서(springdoc). 운영 노출 범위는 후속에서 프로파일로 조일 수 있다.
                        .requestMatchers("/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").permitAll()
                        // T0 스캐폴드 잔재: CP0에서 실제 /api/session/* 이 생기면 이 permitAll을 걷어내야 한다.
                        .requestMatchers("/actuator/health", "/api/ping", "/api/session/**").permitAll()
                        // Prometheus 스크레이프 대상(세션 없이 접근). 메트릭(JVM·요청통계) 노출이라
                        // 운영 배포 전엔 별도 관리 포트(management.server.port)나 네트워크 ACL로 제한할 것.
                        .requestMatchers("/actuator/prometheus").permitAll()
                        // 로그인 전에 부를 수 있어야 하는 것들 — csrf가 막히면 로그인 자체가 불가능하다.
                        .requestMatchers(HttpMethod.GET, "/api/auth/csrf", "/api/auth/email-availability").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/signup", "/api/auth/login", "/api/auth/logout").permitAll()
                        // 공개 카탈로그 조회는 비로그인도 가능(GET만).
                        .requestMatchers(HttpMethod.GET, "/api/curriculums", "/api/curriculums/**").permitAll()
                        // 수강 신청·취소는 학생만(강사 계정은 수강 불가 — 계정 분리 정책). 강사 승인 등은 /api/instructor/**.
                        .requestMatchers(HttpMethod.POST, "/api/curriculums/*/enrollments").hasRole("STUDENT")
                        .requestMatchers(HttpMethod.DELETE, "/api/curriculums/*/enrollments/me").hasRole("STUDENT")
                        // 강사 관리 API는 INSTRUCTOR 역할 필수. 소유권(내 커리큘럼인가)은 서비스가 별도로 검증한다.
                        .requestMatchers("/api/instructor/**").hasRole("INSTRUCTOR")
                        // 에셋 업로드는 로그인 필수(익명 발급 금지). kind별 세부 권한(THUMBNAIL=강사)은
                        // 컨트롤러가 판정한다. anyRequest().authenticated()로도 덮이지만 의도를 못박아 둔다.
                        .requestMatchers("/api/assets/**").authenticated()
                        .anyRequest().authenticated()
                )
                // 기본 동작은 403이지만 CONTRACT §2는 인증 실패를 401로 못박았다.
                .exceptionHandling(ex -> ex.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)));
        return http.build();
    }

    /** {bcrypt} 접두사를 붙여 저장 → 나중에 해시 알고리즘을 바꿔도 기존 행을 읽을 수 있다. */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }
}
