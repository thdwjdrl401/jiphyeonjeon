package com.liveclass.common.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * WebSocket 핸드셰이크 오리진 화이트리스트. WS는 쿠키를 자동 전송하므로 CSWSH(교차 사이트 WS 하이재킹)를
 * 오리진 검증으로 막는다 — CSRF 토큰이 아니라 이게 WS의 정석 방어다. 같은 오리진 배포(nginx)라 운영은
 * 도메인 하나, dev는 Vite(localhost:*)만 허용한다.
 */
@ConfigurationProperties("liveclass.ws")
public record WsProperties(List<String> allowedOriginPatterns) {
}
