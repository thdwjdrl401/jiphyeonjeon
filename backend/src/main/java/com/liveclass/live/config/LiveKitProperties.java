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
        long tokenTtlSeconds,

        /**
         * explicit AgentDispatch로 지목할 STT agent 이름(CONTRACT §3-3). realtime-agent의
         * {@code STT_AGENT_NAME} 환경변수와 <b>반드시 같은 값</b>이어야 job이 배정된다 — 같은 배포 변수로 관리한다.
         */
        String agentName,

        /**
         * 강사가 <b>끊긴 뒤</b> 방을 얼마나 열어 둘지(초).
         *
         * <p>LiveKit 기본값은 20초다. 그 안에 강사가 돌아오지 못하면 방이 닫히고, 방이 닫히면 Egress가
         * 종료되어 <b>HLS와 녹화가 영구히 끊긴다</b> — 강사가 다시 들어와도 그 방송은 되살아나지 않는다.
         * 지하철·와이파이 전환처럼 수십 초 끊기는 일이 흔하므로 기본값으로는 강의를 진행할 수 없다.
         *
         * <p>길게 두는 대가는 빈 방이 그만큼 남는 것뿐이다(참가자가 없으면 미디어도 흐르지 않는다).
         * 강의 종료는 명시적 종료 버튼이 처리하므로 이 값이 세션 수명을 늘리지도 않는다.
         */
        int roomDepartureTimeoutSeconds,

        /**
         * 방을 만든 뒤 <b>아무도 들어오지 않을 때</b> 닫기까지의 시간(초). LiveKit 기본값 300초.
         *
         * <p>preflight에서 방을 먼저 만들고 강사가 장치를 점검한 뒤 접속하므로, 이 시간이 점검에 걸리는
         * 시간보다 짧으면 접속 직전에 방이 사라진다.
         */
        int roomEmptyTimeoutSeconds
) {
}
