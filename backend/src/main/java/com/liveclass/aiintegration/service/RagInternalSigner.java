package com.liveclass.aiintegration.service;

import com.liveclass.aiintegration.config.RagApiProperties;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;

/**
 * {@code X-Internal-Signature} 발급기(ADR-0023 §9.1). 서명 대상은 요청 <b>원시 body 바이트 전체</b>다 —
 * 호출자는 직렬화한 그 바이트 배열을 그대로 서명하고 그대로 전송해야 한다. 재직렬화하면(필드 순서·
 * 공백·escape가 달라져) 서명이 어긋나 ai-api가 401을 낸다.
 *
 * <p>시크릿은 콜백용({@code AI_CALLBACK_SECRET})이 아니라 {@code AI_INTERNAL_SECRET}이다.
 */
@Component
public class RagInternalSigner {

    private final byte[] secret;

    public RagInternalSigner(RagApiProperties properties) {
        this.secret = properties.internalSecret().getBytes(StandardCharsets.UTF_8);
    }

    /** {@code base64(HMAC-SHA256(AI_INTERNAL_SECRET, rawBody))}. */
    public String sign(byte[] rawBody) {
        return HmacSha256.base64(secret, rawBody);
    }
}
