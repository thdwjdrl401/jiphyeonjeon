package com.liveclass.common.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;

/**
 * 인증 = HttpOnly 쿠키 + Redis 세션 (ADR-0014).
 * T0 스캐폴드 단계: 스모크 엔드포인트만 permitAll. 실제 인증/인가는 CP0에서.
 */
@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                // SPA용 CSRF: JS가 XSRF-TOKEN 쿠키를 읽어 헤더로 에코 (ADR-0014)
                .csrf(csrf -> csrf.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse()))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/health", "/api/v1/ping", "/api/v1/session/**").permitAll()
                        .anyRequest().authenticated()
                );
        return http.build();
    }
}
