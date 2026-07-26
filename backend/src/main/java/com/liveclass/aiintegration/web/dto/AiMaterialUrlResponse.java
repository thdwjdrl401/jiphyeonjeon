package com.liveclass.aiintegration.web.dto;

/**
 * Spring → AI 워커, 발급된 presigned GET URL(ADR-0036 B안). 워커는 이 URL로 파일 바이트를 즉시 GET 한다.
 * 발급 직후 쓰라고 주는 단명 URL이므로 저장·재사용하지 않는다(만료되면 다시 요청).
 */
public record AiMaterialUrlResponse(String url) {
}
