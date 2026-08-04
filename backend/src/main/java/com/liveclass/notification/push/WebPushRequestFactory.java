package com.liveclass.notification.push;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.security.PrivateKey;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 구독 하나에 보낼 요청을 만든다 — 암호화(RFC 8291) + VAPID 서명(RFC 8292) + 헤더.
 *
 * <p><b>VAPID 토큰은 오리진마다 하나면 된다.</b> 대상(`aud`)이 엔드포인트의 오리진이고 만료가
 * 몇 시간이라, 기기마다 다시 서명할 이유가 없다. 팬아웃 한 조각의 기기 대부분이 같은 오리진
 * (거의 전부 `fcm.googleapis.com`)이므로 캐시 적중률이 사실상 100%다.
 *
 * <p>만료 직전에는 새로 만든다. 시계가 조금 어긋나도 거부되지 않도록 <b>여유를 두고</b> 바꾼다.
 */
final class WebPushRequestFactory {

    private static final Logger log = LoggerFactory.getLogger(WebPushRequestFactory.class);

    /** RFC 8292는 24시간 이내를 요구한다. 절반만 쓴다 — 시계 차이에 여유를 둔다. */
    private static final Duration TOKEN_LIFETIME = Duration.ofHours(12);
    /** 만료 이 정도 전이면 미리 갈아 끼운다. 발송 도중에 만료되면 그 조각이 통째로 401을 받는다. */
    private static final Duration RENEW_BEFORE = Duration.ofMinutes(30);
    /** 4주. 기기가 꺼져 있어도 켜지면 받게 한다. */
    private static final String TTL = "2419200";

    private final PrivateKey vapidPrivateKey;
    private final byte[] vapidPublicKey;
    private final String subject;
    private final Map<String, CachedToken> tokensByOrigin = new ConcurrentHashMap<>();

    WebPushRequestFactory(WebPushProperties properties) {
        this.vapidPrivateKey = WebPushCrypto.decodePrivateKey(
                WebPushCrypto.decodeBase64Url(properties.privateKey()));
        this.vapidPublicKey = WebPushCrypto.decodeBase64Url(properties.publicKey());
        this.subject = properties.subject();
        if (this.vapidPublicKey.length != 65 || this.vapidPublicKey[0] != 0x04) {
            // 기동 때 알아야 한다. 발송 시점에 알면 이미 알림이 안 나간 뒤다.
            throw new IllegalStateException("VAPID 공개키가 P-256 비압축 점이 아닙니다.");
        }
        log.info("웹 푸시 요청 생성기 준비 — VAPID 토큰은 오리진마다 하나만 만든다");
    }

    WebPushRequest create(PushSubscription subscription, byte[] payload) {
        URI endpoint = URI.create(subscription.getEndpoint());
        byte[] body = WebPushCrypto.encrypt(
                payload,
                WebPushCrypto.decodeBase64Url(subscription.getP256dh()),
                WebPushCrypto.decodeBase64Url(subscription.getAuth()));

        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", authorizationFor(originOf(endpoint)));
        headers.put("Content-Encoding", "aes128gcm");
        headers.put("Content-Type", "application/octet-stream");
        headers.put("TTL", TTL);
        return new WebPushRequest(endpoint, headers, body);
    }

    /**
     * 오리진만 뽑는다. <b>경로가 붙으면 푸시 서비스가 거부한다</b> — `aud`는 오리진이어야 한다.
     * 기본 포트는 적지 않는다.
     */
    private static String originOf(URI endpoint) {
        String scheme = endpoint.getScheme();
        int port = endpoint.getPort();
        boolean defaultPort = port < 0
                || ("https".equals(scheme) && port == 443)
                || ("http".equals(scheme) && port == 80);
        return scheme + "://" + endpoint.getHost() + (defaultPort ? "" : ":" + port);
    }

    private String authorizationFor(String origin) {
        Instant now = Instant.now();
        CachedToken cached = tokensByOrigin.get(origin);
        if (cached != null && cached.usableAt(now)) {
            return cached.value();
        }
        Instant expiresAt = now.plus(TOKEN_LIFETIME);
        String value = WebPushCrypto.vapidAuthorization(
                origin, subject, vapidPrivateKey, vapidPublicKey, expiresAt.getEpochSecond());
        /*
         * 경쟁이 나도 문제가 없다 — 서로 다른 토큰이 만들어져도 둘 다 유효하다. 그래서 잠그지 않고
         * 마지막 것이 남게 둔다.
         */
        tokensByOrigin.put(origin, new CachedToken(value, expiresAt));
        return value;
    }

    private record CachedToken(String value, Instant expiresAt) {

        boolean usableAt(Instant now) {
            return now.isBefore(expiresAt.minus(RENEW_BEFORE));
        }
    }
}
