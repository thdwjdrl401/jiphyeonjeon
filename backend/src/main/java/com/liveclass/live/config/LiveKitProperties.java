package com.liveclass.live.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * LiveKit 접속·서명 설정. apiSecret은 커밋하지 않는다 — 운영은 환경변수(LIVEKIT_API_SECRET 등)로 주입.
 * dev/test 기본값은 더미(서명은 되지만 실제 LiveKit 서버는 인증 안 함)라 서버 없이 토큰 구조를 테스트할 수 있다.
 */
@ConfigurationProperties(prefix = "livekit")
public record LiveKitProperties(

        /** <b>브라우저</b>가 WebRTC로 접속할 공개 wss URL. 토큰 응답에 그대로 실린다. */
        String url,

        /**
         * <b>백엔드</b>가 방 제어·Egress 시작에 쓰는 서버 API URL.
         *
         * <p>브라우저 접속 주소와 나눈 이유: 같은 LiveKit 서버라도 둘의 네트워크 위치가 다르다.
         * 브라우저는 공개 도메인으로 오지만 백엔드는 같은 호스트 안에서 부른다. 하나로 쓰면
         * 브라우저 접속 경로를 바꿀 때 서버 호출까지 끌려간다.
         *
         * <p>비우면 {@link #url}에서 파생한다(wss→https) — 단일 호스트 개발 환경은 둘이 같다.
         */
        String apiUrl,

        /** API 키(공개 식별자). */
        String apiKey,

        /** API 시크릿(서명 키). 절대 응답·로그·커밋에 노출 금지. */
        String apiSecret,

        /** 토큰 유효시간(초). */
        long tokenTtlSeconds
) {
}
