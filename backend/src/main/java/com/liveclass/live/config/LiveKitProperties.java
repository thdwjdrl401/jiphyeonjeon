package com.liveclass.live.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * LiveKit 접속·서명 설정. apiSecret은 커밋하지 않는다 — 운영은 환경변수(LIVEKIT_API_SECRET 등)로 주입.
 * dev/test 기본값은 더미(서명은 되지만 실제 LiveKit 서버는 인증 안 함)라 서버 없이 토큰 구조를 테스트할 수 있다.
 */
@ConfigurationProperties(prefix = "livekit")
public record LiveKitProperties(

        /** 클라이언트가 접속할 LiveKit wss URL. */
        String url,

        /** API 키(공개 식별자). */
        String apiKey,

        /** API 시크릿(서명 키). 절대 응답·로그·커밋에 노출 금지. */
        String apiSecret,

        /** 토큰 유효시간(초). */
        long tokenTtlSeconds
) {
}
