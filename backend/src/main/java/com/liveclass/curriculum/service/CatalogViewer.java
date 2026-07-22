package com.liveclass.curriculum.service;

import java.util.UUID;

/**
 * 카탈로그를 보고 있는 사용자. 비로그인이면 {@link #guest()}.
 *
 * <p>역할(instructor)은 인증 주체의 권한에서 그대로 온다 — viewerContext 하나 만들자고 auth 모듈을
 * 다시 조회하지 않기 위해서다. 소유권(내 커리큘럼인가)은 커리큘럼의 instructorId와 비교해 판정한다.
 */
public record CatalogViewer(UUID userId, boolean instructor) {

    private static final CatalogViewer GUEST = new CatalogViewer(null, false);

    public static CatalogViewer guest() {
        return GUEST;
    }

    public boolean isGuest() {
        return userId == null;
    }
}
