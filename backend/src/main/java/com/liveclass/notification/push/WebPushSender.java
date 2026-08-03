package com.liveclass.notification.push;

import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;
import org.apache.http.HttpResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.security.GeneralSecurityException;
import java.security.Security;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 브라우저 푸시 서비스로 실제 발송(ADR-0073 §9).
 *
 * <p>STOMP 신호와 다른 층이다 — STOMP는 <b>탭이 열려 있어야</b> 닿고, 이건 탭을 닫아도 닿는다.
 * 그래서 둘을 함께 보낸다.
 *
 * <p><b>죽은 구독을 즉시 지운다.</b> 푸시 서비스가 404·410을 주면 그 구독은 영영 살아나지 않는다
 * (브라우저를 지웠거나 권한을 껐다). 남겨 두면 그 사람에게 알림이 갈 때마다 실패 요청이 하나씩
 * 늘어나고, 시간이 지날수록 발송의 대부분이 죽은 구독을 두드리는 일이 된다.
 *
 * <p><b>키가 없으면 조용히 꺼진다.</b> 로컬·테스트에서 VAPID 키를 만들 이유가 없고, 없다고 알림
 * 자체가 멈추면 안 된다 — 푸시는 알림함 위에 얹는 층이다.
 */
@Component
public class WebPushSender {

    private static final Logger log = LoggerFactory.getLogger(WebPushSender.class);

    /** 푸시 서비스가 "이 구독은 끝났다"고 답하는 두 코드. 다른 코드는 일시적일 수 있어 지우지 않는다. */
    private static final int GONE = 410;
    private static final int NOT_FOUND = 404;

    private final PushSubscriptionRepository repository;
    private final WebPushProperties properties;
    private final PushService pushService;

    public WebPushSender(PushSubscriptionRepository repository, WebPushProperties properties) {
        this.repository = repository;
        this.properties = properties;
        this.pushService = createPushService(properties);
    }

    private static PushService createPushService(WebPushProperties properties) {
        if (!properties.isConfigured()) {
            return null;
        }
        // 라이브러리가 요구하는 암호 제공자. 이미 등록돼 있으면 무해하게 무시된다.
        Security.addProvider(new org.bouncycastle.jce.provider.BouncyCastleProvider());
        try {
            return new PushService(properties.publicKey(), properties.privateKey(), properties.subject());
        } catch (GeneralSecurityException e) {
            // 키가 있는데 형식이 틀렸다면 기동 시점에 알아야 한다 — 조용히 꺼지면 배포 후에야 안다.
            throw new IllegalStateException("VAPID 키 형식이 올바르지 않습니다.", e);
        }
    }

    public boolean isEnabled() {
        return pushService != null;
    }

    /** 이 사람들의 <b>모든 기기</b>로 보낸다. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void send(Collection<UUID> recipientIds, String title, String body, String url) {
        if (!isEnabled() || recipientIds.isEmpty()) {
            return;
        }
        List<PushSubscription> subscriptions = repository.findByUserIdIn(recipientIds);
        String payload = PushPayload.json(title, body, url);
        for (PushSubscription subscription : subscriptions) {
            sendOne(subscription, payload);
        }
    }

    private void sendOne(PushSubscription subscription, String payload) {
        try {
            HttpResponse response = pushService.send(new Notification(
                    subscription.getEndpoint(), subscription.getP256dh(), subscription.getAuth(),
                    payload.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            int status = response.getStatusLine().getStatusCode();
            if (status == GONE || status == NOT_FOUND) {
                repository.delete(subscription);
                log.info("죽은 푸시 구독 정리 status={} id={}", status, subscription.getId());
                return;
            }
            if (status >= 200 && status < 300) {
                subscription.setLastSuccessAt(OffsetDateTime.now());
                return;
            }
            log.warn("푸시 발송 실패 status={} id={}", status, subscription.getId());
        } catch (Exception e) {
            /*
             * 한 기기 실패로 나머지를 막지 않는다. 푸시는 알림함 위에 얹는 층이라, 여기서 예외를
             * 올리면 이미 저장된 알림 때문에 워커가 조각 전체를 재시도한다.
             */
            log.warn("푸시 발송 오류 id={}: {}", subscription.getId(), e.toString());
        }
    }
}
