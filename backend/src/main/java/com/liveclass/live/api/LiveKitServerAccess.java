package com.liveclass.live.api;

/**
 * LiveKit 서버 API 접속 정보(경계 DTO). LiveKit 설정은 live 모듈이 소유하고, 서버 API를 직접
 * 호출해야 하는 형제 모듈(video의 Egress 제어)에는 이 포트로만 노출한다 — live.config는 내부다.
 *
 * <p>{@code apiUrl}은 접속용 wss가 아니라 <b>서버 API용 http(s)</b>로 이미 변환된 값이다(변환은 live가 한 번만).
 * {@code apiSecret}은 서명 키라 응답·로그에 절대 노출하지 않는다.
 */
public record LiveKitServerAccess(

        String apiUrl,
        String apiKey,
        String apiSecret
) {
}
