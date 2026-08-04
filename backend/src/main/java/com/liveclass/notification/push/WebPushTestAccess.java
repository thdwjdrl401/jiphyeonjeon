package com.liveclass.notification.push;

import java.util.Map;

/**
 * 테스트가 암호화 층을 들여다보는 창.
 *
 * <p>{@link WebPushCrypto}와 {@link WebPushRequestFactory}는 패키지 밖으로 열 이유가 없지만,
 * <b>이 층은 반드시 밖에서 검증돼야 한다</b> — 틀려도 푸시 서비스가 2xx를 주기 때문에 실패가
 * 조용하다. 그래서 테스트용 통로만 최소로 낸다.
 */
public final class WebPushTestAccess {

    private WebPushTestAccess() {
    }

    /** 구독 하나에 보낼 요청(암호화 + VAPID 서명 + 헤더)을 만든다. */
    public static Prepared create(WebPushProperties properties,
                                  PushSubscription subscription, byte[] payload) {
        WebPushRequest request = new WebPushRequestFactory(properties).create(subscription, payload);
        return new Prepared(request.headers(), request.body());
    }

    public static String base64Url(byte[] bytes) {
        return WebPushCrypto.base64Url(bytes);
    }

    public record Prepared(Map<String, String> headers, byte[] body) {
    }
}
