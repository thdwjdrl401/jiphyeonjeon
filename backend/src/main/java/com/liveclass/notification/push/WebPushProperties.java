package com.liveclass.notification.push;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * VAPID 키쌍과 연락처(RFC 8292).
 *
 * <p><b>벤더 계정이 필요 없다.</b> 키쌍은 우리가 만들고, 푸시 서비스는 그 서명으로 "같은 서버가
 * 보냈다"만 확인한다. 공개키는 브라우저가 구독할 때 쓰므로 응답으로 내보내고, <b>개인키는 절대
 * 나가지 않는다</b>.
 *
 * <p>키가 없으면 푸시는 <b>꺼진 채로 동작한다</b>. 로컬·테스트에서 키를 만들 이유가 없고, 없다고
 * 알림 자체가 멈추면 안 된다 — 푸시는 알림함 위에 얹는 층이다.
 *
 * @param subject {@code mailto:} 또는 {@code https:} URL. 푸시 서비스가 문제 생겼을 때 연락할 곳이다.
 */
@ConfigurationProperties(prefix = "notification.web-push")
public record WebPushProperties(
        String publicKey,
        String privateKey,
        String subject
) {

    public boolean isConfigured() {
        return publicKey != null && !publicKey.isBlank()
                && privateKey != null && !privateKey.isBlank();
    }
}
