package com.liveclass.notification.push;

import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.security.GeneralSecurityException;
import java.security.Security;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Semaphore;

/**
 * 브라우저 푸시 서비스로 실제 발송(ADR-0073 §9).
 *
 * <p>STOMP 신호와 다른 층이다 — STOMP는 <b>탭이 열려 있어야</b> 닿고, 이건 탭을 닫아도 닿는다.
 *
 * <p><b>Web Push에는 배치가 없다.</b> 표준에 기기 여러 대를 한 요청으로 보내는 방법이 없어서
 * 구독 수만큼 HTTPS를 쳐야 한다. 그래서 이 층의 관건은 요청 수를 줄이는 것이 아니라
 * <b>많은 요청을 겹쳐서, 다른 일을 막지 않고</b> 치는 것이다.
 *
 * <ul>
 *   <li><b>공유 클라이언트</b> — 연결을 재사용한다({@link WebPushHttpClient}에 이유가 있다).</li>
 *   <li><b>동시 상한</b> — 세마포어로 in-flight를 묶는다. 안 묶으면 조각 하나가 기기 수천 대일 때
 *       요청이 한꺼번에 나가 푸시 서비스가 429로 막고, 펜딩 객체가 메모리에 쌓인다.</li>
 *   <li><b>DB는 마지막에 한 번</b> — 발송 중에는 엔티티를 건드리지 않는다. HTTP를 기다리는 동안
 *       트랜잭션이 열려 있으면 커넥션을 그만큼 붙잡는다.</li>
 * </ul>
 *
 * <p><b>죽은 구독은 즉시 지운다.</b> 404·410은 영영 살아나지 않는다(브라우저를 지웠거나 권한을
 * 껐다). 남겨 두면 시간이 갈수록 발송의 대부분이 죽은 구독을 두드리는 일이 된다.
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
    private final PushService pushService;
    private final WebPushHttpClient httpClient;
    private final Semaphore inFlight;
    private final Duration batchTimeout;
    /*
     * 트랜잭션을 애너테이션이 아니라 손으로 연다. 같은 클래스 안에서 부르는 메서드에 @Transactional을
     * 달면 프록시를 타지 않아 **조용히 아무 일도 안 한다** — 여기서는 그게 "HTTP를 기다리는 동안
     * 트랜잭션이 열려 있다"는 정반대 결과가 된다.
     */
    private final TransactionTemplate readTx;
    private final TransactionTemplate writeTx;

    public WebPushSender(PushSubscriptionRepository repository,
                         WebPushProperties properties,
                         PlatformTransactionManager transactionManager,
                         @Value("${notification.web-push.max-in-flight:200}") int maxInFlight,
                         @Value("${notification.web-push.connect-timeout-ms:5000}") long connectTimeoutMs,
                         @Value("${notification.web-push.request-timeout-ms:10000}") long requestTimeoutMs,
                         @Value("${notification.web-push.batch-timeout-ms:60000}") long batchTimeoutMs) {
        this.repository = repository;
        this.pushService = createPushService(properties);
        this.httpClient = new WebPushHttpClient(
                Duration.ofMillis(connectTimeoutMs), Duration.ofMillis(requestTimeoutMs));
        this.inFlight = new Semaphore(maxInFlight);
        this.batchTimeout = Duration.ofMillis(batchTimeoutMs);
        this.readTx = new TransactionTemplate(transactionManager);
        this.readTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.readTx.setReadOnly(true);
        this.writeTx = new TransactionTemplate(transactionManager);
        this.writeTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
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

    /**
     * 이 사람들의 <b>모든 기기</b>로 보낸다.
     *
     * <p>단계가 셋이고 <b>가운데 단계에만 시간이 든다</b> — 구독 조회(짧은 읽기) → 병렬 발송(HTTP,
     * 트랜잭션 밖) → 결과 반영(짧은 쓰기).
     */
    public void send(Collection<UUID> recipientIds, String title, String body, String url) {
        if (!isEnabled() || recipientIds.isEmpty()) {
            return;
        }
        List<PushSubscription> subscriptions = loadSubscriptions(recipientIds);
        if (subscriptions.isEmpty()) {
            return;
        }
        byte[] payload = PushPayload.json(title, body, url)
                .getBytes(java.nio.charset.StandardCharsets.UTF_8);

        List<Outcome> outcomes = dispatch(subscriptions, payload);
        applyOutcomes(outcomes);
    }

    private List<PushSubscription> loadSubscriptions(Collection<UUID> recipientIds) {
        // 사람마다 조회하면 조각 크기만큼 왕복이 생긴다 — 한 번에 가져온다.
        return readTx.execute(status -> repository.findByUserIdIn(recipientIds));
    }

    /**
     * 전부 띄우고 전부 기다린다. <b>트랜잭션 밖</b>이라 DB 커넥션을 붙잡지 않는다.
     *
     * <p>세마포어는 <b>제출 시점</b>에 잡고 <b>완료 시점</b>에 놓는다. 그래서 in-flight가 상한을
     * 넘지 않고, 느린 푸시 서비스가 있어도 그쪽으로만 몰릴 뿐 전체가 멈추지 않는다.
     */
    private List<Outcome> dispatch(List<PushSubscription> subscriptions, byte[] payload) {
        List<CompletableFuture<Outcome>> futures = new ArrayList<>(subscriptions.size());
        for (PushSubscription subscription : subscriptions) {
            futures.add(sendOne(subscription, payload));
        }
        try {
            CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
                    .get(batchTimeout.toMillis(), java.util.concurrent.TimeUnit.MILLISECONDS);
        } catch (Exception e) {
            /*
             * 조각 전체가 늦어도 여기서 멈추지 않는다. 끝난 것만 반영하고 나머지는 버린다 —
             * 푸시는 못 받아도 알림함에 남아 있고, 여기서 예외를 올리면 이미 저장된 알림 때문에
             * 워커가 조각 전체를 재시도해 **이미 받은 사람에게 두 번 울린다**.
             */
            log.warn("푸시 배치가 제한 시간 안에 끝나지 않았습니다 — 완료분만 반영합니다: {}", e.toString());
        }
        List<Outcome> done = new ArrayList<>(futures.size());
        for (CompletableFuture<Outcome> future : futures) {
            Outcome outcome = future.getNow(null);
            if (outcome != null) {
                done.add(outcome);
            }
        }
        return done;
    }

    private CompletableFuture<Outcome> sendOne(PushSubscription subscription, byte[] payload) {
        try {
            inFlight.acquire();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return CompletableFuture.completedFuture(new Outcome(subscription, -1));
        }
        try {
            // 암호화(RFC 8291)와 VAPID 서명(RFC 8292)은 라이브러리가 한다. 우리는 실어 보내기만.
            var prepared = pushService.preparePost(new Notification(
                    subscription.getEndpoint(), subscription.getP256dh(), subscription.getAuth(), payload),
                    nl.martijndwars.webpush.Encoding.AES128GCM);
            return httpClient.send(prepared)
                    .handle((status, error) -> {
                        if (error != null) {
                            log.warn("푸시 발송 오류 id={}: {}", subscription.getId(), error.toString());
                            return new Outcome(subscription, -1);
                        }
                        return new Outcome(subscription, status);
                    })
                    .whenComplete((ignored, ignoredError) -> inFlight.release());
        } catch (Exception e) {
            inFlight.release();
            // 암호화 실패는 그 구독의 키가 깨졌다는 뜻이다. 나머지 기기는 계속 보낸다.
            log.warn("푸시 요청 생성 실패 id={}: {}", subscription.getId(), e.toString());
            return CompletableFuture.completedFuture(new Outcome(subscription, -1));
        }
    }

    /** 발송이 다 끝난 뒤 <b>한 번</b>에 반영한다. HTTP를 기다리는 동안 트랜잭션을 열어 두지 않는다. */
    private void applyOutcomes(List<Outcome> outcomes) {
        if (outcomes.isEmpty()) {
            return;
        }
        writeTx.executeWithoutResult(status -> applyOutcomesInTx(outcomes));
    }

    private void applyOutcomesInTx(List<Outcome> outcomes) {
        List<PushSubscription> dead = new ArrayList<>();
        OffsetDateTime now = OffsetDateTime.now();
        int delivered = 0;
        for (Outcome outcome : outcomes) {
            int status = outcome.status();
            if (status == GONE || status == NOT_FOUND) {
                dead.add(outcome.subscription());
            } else if (status >= 200 && status < 300) {
                outcome.subscription().setLastSuccessAt(now);
                delivered++;
            } else if (status > 0) {
                log.warn("푸시 발송 실패 status={} id={}", status, outcome.subscription().getId());
            }
        }
        if (!dead.isEmpty()) {
            repository.deleteAll(dead);
            log.info("죽은 푸시 구독 {}건 정리", dead.size());
        }
        if (!outcomes.isEmpty()) {
            repository.saveAll(outcomes.stream()
                    .filter(o -> o.status() >= 200 && o.status() < 300)
                    .map(Outcome::subscription)
                    .toList());
        }
        log.debug("푸시 배치 완료 성공={} 정리={} 전체={}", delivered, dead.size(), outcomes.size());
    }

    /** 기기 하나의 결과. {@code status < 0}은 응답을 못 받았다는 뜻이다(오류·타임아웃). */
    record Outcome(PushSubscription subscription, int status) {
    }
}
