package com.liveclass.video.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;

@Component
public class RecordedSttWorkerVerifier {

    private final byte[] sourceSecret;
    private final byte[] callbackSecret;

    public RecordedSttWorkerVerifier(
            @Value("${recorded.stt.source-secret:dev-recorded-stt-source-secret}") String sourceSecret,
            @Value("${recorded.stt.callback-secret:dev-recorded-stt-callback-secret}") String callbackSecret) {
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
            throw new RecordedSttWorkerUnauthorizedException("녹화 STT 워커 서명이 없습니다.");
        }
        String expected = hmacBase64(secret, body == null ? new byte[0] : body);
        if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                signature.getBytes(StandardCharsets.UTF_8))) {
            throw new RecordedSttWorkerUnauthorizedException("녹화 STT 워커 서명이 유효하지 않습니다.");
        }
    }

    private String hmacBase64(byte[] secret, byte[] body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return Base64.getEncoder().encodeToString(mac.doFinal(body));
        } catch (Exception e) {
            throw new IllegalStateException("녹화 STT HMAC 계산 실패", e);
        }
    }
}
