package com.liveclass.notification.push;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/** 브라우저 구독의 등록·해제. */
@Service
public class PushSubscriptionService {

    private static final Logger log = LoggerFactory.getLogger(PushSubscriptionService.class);

    private final PushSubscriptionRepository repository;

    public PushSubscriptionService(PushSubscriptionRepository repository) {
        this.repository = repository;
    }

    /**
     * 등록. <b>멱등이다</b> — 브라우저는 이미 구독돼 있어도 다시 등록을 시도한다(권한을 다시 확인할
     * 때, 서비스워커가 갱신될 때). 같은 엔드포인트면 새 행이 아니라 그 행을 갱신한다.
     *
     * <p>엔드포인트를 다른 사람이 들고 오면 <b>주인을 바꾼다</b>. 같은 브라우저에서 로그아웃하고
     * 다른 계정으로 들어온 경우가 그렇다 — 그대로 두면 이전 사용자의 알림이 이 기기로 계속 간다.
     */
    @Transactional
    public void register(UUID userId, String endpoint, String p256dh, String auth, String userAgent) {
        PushSubscription subscription = repository.findByEndpoint(endpoint)
                .orElseGet(PushSubscription::new);
        subscription.setUserId(userId);
        subscription.setEndpoint(endpoint);
        subscription.setP256dh(p256dh);
        subscription.setAuth(auth);
        subscription.setUserAgent(userAgent);
        repository.save(subscription);
        log.info("푸시 구독 등록 user={}", userId);
    }

    /**
     * <b>이 브라우저의 구독이 내 앞으로 살아 있는가.</b>
     *
     * <p>화면이 "브라우저 알림 켜짐"을 그리려면 브라우저가 구독 객체를 갖고 있다는 것만으로는
     * 부족하다 — 그 객체는 로그아웃해도, 다른 계정으로 갈아타도 브라우저에 그대로 남는다
     * (로그아웃은 서버 행만 지운다). 실제로 푸시가 오는지는 <b>서버에 그 엔드포인트가 내 것으로
     * 있는가</b>가 정한다.
     *
     * <p>엔드포인트를 받아 그것 하나만 확인한다. 내 구독 목록 전체를 내려보내면 화면이 쓰지도 않을
     * 다른 기기의 식별자까지 브라우저로 나간다.
     */
    @Transactional(readOnly = true)
    public boolean isRegisteredFor(UUID userId, String endpoint) {
        return repository.findByEndpoint(endpoint)
                .filter(subscription -> userId.equals(subscription.getUserId()))
                .isPresent();
    }

    /**
     * 해제. <b>자기 구독만</b> 지운다 — 엔드포인트만으로 지우게 두면 남의 엔드포인트 문자열을 아는
     * 사람이 그 기기의 알림을 끊을 수 있다.
     *
     * <p>없는 것을 지워도 성공이다. 브라우저가 이미 구독을 버린 뒤 해제를 부르는 일이 흔하다.
     */
    @Transactional
    public void unregister(UUID userId, String endpoint) {
        repository.deleteByEndpointAndUserId(endpoint, userId);
    }
}
