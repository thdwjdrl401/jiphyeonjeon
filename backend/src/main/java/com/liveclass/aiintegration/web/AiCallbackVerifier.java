package com.liveclass.aiintegration.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

/**
 * AI 콜백의 진위를 검증한다(ADR-0036). AI 워커가 공유 시크릿({@code ai.callback-secret})으로 본문을
 * HMAC-SHA256 서명해 {@code X-Signature}(base64) 헤더에 실어 보낸다. 경로는 permitAll이지만 이 검증이
 * 실질 인증이다(egress webhook 0034와 같은 방식, JWT 대신 단순 HMAC).
 */
@Component
public class AiCallbackVerifier {

    private final byte[] secret;

    public AiCallbackVerifier(@Value("${ai.callback-secret:dev-ai-callback-secret}") String secret) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    /** 검증 실패면 {@link AiCallbackUnverifiedException}(401). 본문은 <b>원시 바이트</b>여야 한다(재직렬화 시 서명 어긋남). */
    public void verify(byte[] body, String signature) {
        if (signature == null || signature.isBlank()) {
            throw new AiCallbackUnverifiedException("콜백 서명이 없습니다.");
        }
        String expected = Base64.getEncoder().encodeToString(hmacSha256(body == null ? new byte[0] : body));
        if (!MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8), signature.getBytes(StandardCharsets.UTF_8))) {
            throw new AiCallbackUnverifiedException("콜백 서명이 유효하지 않습니다.");
        }
    }

    private byte[] hmacSha256(byte[] body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return mac.doFinal(body);
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 계산 실패", e);
        }
    }
}
