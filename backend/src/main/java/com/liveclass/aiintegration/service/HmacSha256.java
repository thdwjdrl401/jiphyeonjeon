package com.liveclass.aiintegration.service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.util.Base64;

/**
 * S2S 공유 시크릿 HMAC-SHA256(base64). 콜백 검증({@code AiCallbackVerifier})과 RAG 서명
 * ({@code RagInternalSigner})이 같은 계산을 쓰도록 한곳에 둔다 — 두 경계 모두 "요청 <b>원시 바이트</b>
 * body를 그대로 서명한다"가 계약이라(CONTRACT §3-2, ADR-0023 §9.1) 재직렬화하면 서명이 어긋난다.
 */
public final class HmacSha256 {

    private HmacSha256() {
    }

    /** {@code base64(HMAC-SHA256(secret, body))}. */
    public static String base64(byte[] secret, byte[] body) {
        return Base64.getEncoder().encodeToString(raw(secret, body));
    }

    private static byte[] raw(byte[] secret, byte[] body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return mac.doFinal(body == null ? new byte[0] : body);
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 계산 실패", e);
        }
    }
}
