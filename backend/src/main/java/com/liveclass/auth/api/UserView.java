package com.liveclass.auth.api;

import java.util.UUID;

/** 다른 모듈에 공개하는 최소 사용자 정보. auth 엔티티를 밖으로 노출하지 않기 위한 경계 DTO. */
public record UserView(

        UUID userId,
        String displayName,
        String role
) {
}
