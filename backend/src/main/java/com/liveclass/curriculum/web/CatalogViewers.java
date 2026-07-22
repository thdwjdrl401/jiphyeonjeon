package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.CatalogViewer;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;

import java.util.UUID;

/**
 * 인증 주체를 카탈로그가 쓰는 {@link CatalogViewer}로 옮긴다.
 *
 * <p>역할은 이미 인증에 실려 온 권한에서 읽는다 — viewerContext 하나 만들자고 auth 모듈을 다시
 * 조회하지 않기 위해서다. 공개 조회 경로에서는 인증이 아예 없거나 익명일 수 있어 손님으로 떨어뜨린다.
 */
final class CatalogViewers {

    private static final String INSTRUCTOR_AUTHORITY = "ROLE_INSTRUCTOR";

    private CatalogViewers() {
    }

    static CatalogViewer of(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            return CatalogViewer.guest();
        }
        try {
            return new CatalogViewer(UUID.fromString(authentication.getName()), isInstructor(authentication));
        } catch (IllegalArgumentException e) {
            // 주체 이름이 userId가 아닌 경우(익명 토큰 등)는 손님으로 다룬다 — 공개 조회를 막지 않는다.
            return CatalogViewer.guest();
        }
    }

    private static boolean isInstructor(Authentication authentication) {
        return authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .anyMatch(INSTRUCTOR_AUTHORITY::equals);
    }
}
