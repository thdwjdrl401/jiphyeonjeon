package com.liveclass.video.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

/** media-worker source URL 요청과 callback을 서로 다른 시크릿으로 검증한다. */
@Component
public class MediaWorkerVerifier {

    private final byte[] sourceSecret;
    private final byte[] callbackSecret;

    public MediaWorkerVerifier(
            @Value("${recorded.video.source-secret:dev-media-source-secret}") String sourceSecret,
            @Value("${recorded.video.callback-secret:dev-media-callback-secret}") String callbackSecret) {
        this.sourceSecret = sourceSecret.getBytes(StandardCharsets.UTF_8);
        this.callbackSecret = callbackSecret.getBytes(StandardCharsets.UTF_8);
    }

    public void verifySource(byte[] body, String signature) {
        verify(sourceSecret, body, signature);
    }

    public void verifyCallback(byte[] body, String signature) {
        verify(callbackSecret, body, signature);
    }

    private void verify(byte[] secret, byte[] body, String signature) {
        if (signature == null || signature.isBlank()) {
            throw new MediaWorkerUnauthorizedException("미디어 워커 서명이 없습니다.");
        }
        byte[] expected = hmac(secret, body);
        byte[] supplied;
        try {
            supplied = Base64.getDecoder().decode(signature);
        } catch (IllegalArgumentException e) {
            throw new MediaWorkerUnauthorizedException("미디어 워커 서명이 유효하지 않습니다.");
        }
        if (!MessageDigest.isEqual(expected, supplied)) {
            throw new MediaWorkerUnauthorizedException("미디어 워커 서명이 유효하지 않습니다.");
        }
    }

    private byte[] hmac(byte[] secret, byte[] body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return mac.doFinal(body == null ? new byte[0] : body);
        } catch (Exception e) {
            throw new IllegalStateException("미디어 워커 HMAC 계산 실패", e);
        }
    }
}
