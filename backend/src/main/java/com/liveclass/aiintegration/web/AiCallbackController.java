package com.liveclass.aiintegration.web;

import com.liveclass.aiintegration.service.AiCallbackService;
import com.liveclass.aiintegration.web.dto.AiCallbackEvent;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;

/**
 * AI 워커 → Spring 콜백 수신(ADR-0036). SecurityConfig에서 permitAll이지만 {@link AiCallbackVerifier}의
 * HMAC 서명 검증이 실질 인증이다. 본문은 <b>원시 바이트</b>로 받는다 — 재직렬화하면 서명이 어긋난다.
 */
@Tag(name = "AI Callback", description = "AI 워커의 처리 완료/실패 콜백을 받아 상태를 확정한다.")
@RestController
public class AiCallbackController {

    private static final Logger log = LoggerFactory.getLogger(AiCallbackController.class);

    private final AiCallbackVerifier verifier;
    private final AiCallbackService service;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public AiCallbackController(AiCallbackVerifier verifier, AiCallbackService service) {
        this.verifier = verifier;
        this.service = service;
    }

    @Operation(summary = "AI 콜백",
            description = "AI 워커의 이벤트(예: MATERIAL_EMBEDDED)를 받아 자료 임베딩 상태를 확정한다. HMAC 서명으로 인증, eventId로 멱등.")
    @PostMapping(value = "/api/internal/ai/callbacks", consumes = MediaType.ALL_VALUE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void onCallback(@RequestBody(required = false) byte[] body,
                           @RequestHeader(value = "X-Signature", required = false) String signature) {
        verifier.verify(body, signature);

        AiCallbackEvent event = jsonMapper.readValue(body, AiCallbackEvent.class);
        if (event == null || event.eventId() == null || event.eventType() == null) {
            return;   // 형식 미달은 조용히 무시(204)
        }
        service.handle(event, new String(body, StandardCharsets.UTF_8));
        log.info("AI 콜백 수신 eventId={} type={}", event.eventId(), event.eventType());
    }
}
