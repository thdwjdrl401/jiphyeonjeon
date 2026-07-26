package com.liveclass.aiintegration.web.dto;

/**
 * AI 워커 → Spring, 자료 파일 URL 발급 요청(ADR-0036 B안). 워커는 임베딩 잡 envelope에서 받은
 * {@code assetId}만 실어 보낸다. 본문은 HMAC 서명 대상이라 워커가 서명한 바이트 그대로여야 한다.
 */
public record AiMaterialUrlRequest(String assetId) {
}
