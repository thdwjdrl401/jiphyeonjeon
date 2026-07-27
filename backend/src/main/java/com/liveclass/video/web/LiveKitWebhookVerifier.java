package com.liveclass.video.web;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.exceptions.JWTVerificationException;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.liveclass.live.api.LiveKitServerAccess;
import org.springframework.stereotype.Component;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;

/**
 * LiveKit webhook의 진위를 검증한다(ADR-0034). LiveKit은 Authorization 헤더에 JWT를 실어 보내는데,
 * JWT는 apiSecret으로 HS256 서명되고 payload의 {@code sha256} 클레임이 본문의 SHA-256(base64)이다.
 * 서명과 본문 해시를 둘 다 확인해야 위조·변조를 막는다. 경로는 permitAll이지만 이 검증이 실질 인증이다.
 */
@Component
public class LiveKitWebhookVerifier {

    private final LiveKitServerAccess livekit;

    public LiveKitWebhookVerifier(LiveKitServerAccess livekit) {
        this.livekit = livekit;
    }

    /** 검증 실패면 {@link WebhookVerificationException}(401)을 던진다. 본문은 <b>원시 바이트</b>여야 한다 — 재직렬화하면 해시가 어긋난다. */
    public void verify(byte[] body, String authHeader) {
        if (authHeader == null || authHeader.isBlank()) {
            throw new WebhookVerificationException("webhook 서명이 없습니다.");
        }
        try {
            DecodedJWT jwt = JWT.require(Algorithm.HMAC256(livekit.apiSecret())).build().verify(authHeader);
            String expected = jwt.getClaim("sha256").asString();
            String actual = Base64.getEncoder().encodeToString(sha256(body));
            if (expected == null || !expected.equals(actual)) {
                throw new WebhookVerificationException("webhook 본문 해시가 일치하지 않습니다.");
            }
        } catch (JWTVerificationException e) {
            throw new WebhookVerificationException("webhook 서명이 유효하지 않습니다.", e);
        }
    }

    private byte[] sha256(byte[] body) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(body == null ? new byte[0] : body);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 미지원", e);
        }
    }
}
