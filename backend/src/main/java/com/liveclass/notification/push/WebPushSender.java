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
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;

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
 * <p><b>암호화는 따로 논다.</b> {@code preparePost}는 순수 CPU 작업인데(ECDH + HKDF + AES-GCM +
 * VAPID 서명) <b>실측으로 운영 장비에서 건당 7.79ms</b>다. 이걸 큐 소비자 스레드가 순서대로 하면
 * 제출 속도가 초당 172건에 묶여, HTTP를 아무리 겹쳐도 그 위로 못 간다 — 100만이면 97분이
 * <b>네트워크가 아니라 CPU에서</b> 간다.
 *
 * <p>그래서 암호화를 전용 풀에 넘긴다. 4코어에서 초당 444건까지 오르고, 그건 연결 하나의 HTTP
 * 상한(초당 435건)과 거의 같다 — 즉 <b>이 둘은 짝이다</b>. 병렬화 없이 연결만 늘리면 CPU가 못
 * 따라와 놀고, 연결 하나로 병렬화만 하면 스트림 100개가 모자란다.
 *
 * <p><b>계산 결과는 달라지지 않는다.</b> 같은 함수를 다른 스레드에서 부를 뿐이라, 암호문이 조용히
 * 틀리는 종류의 위험이 없다.
 *
 * <p><b>재시도는 기기 단위다.</b> 조각을 통째로 다시 보내면 <b>이미 받은 사람이 두 번 울린다</b> —
 * Web Push에는 멱등 키가 없어서 같은 endpoint로 두 번 POST하면 기기가 두 번 운다. 그런데 어느
 * 기기가 실패했는지는 결과에 정확히 남아 있으므로, <b>실패한 것만</b> 다시 보내면 중복이 없다.
 * 성공(2xx)한 구독은 두 번째 물결에 <b>절대 들어가지 않는다</b> — 이것이 이 층의 불변식이다.
 *
 * <p>큐가 대신해 줄 수 없는 일이라 여기서 한다. 이 메서드가 예외를 던져 메시지가 재배달되면
 * 알림 행은 이미 커밋돼 있어 중복 제거가 수신자 명단을 <b>비워서</b> 돌려주고, 그러면 못 받은
 * 사람도 영영 못 받는다. 재시도할 수 있는 단위(조각)와 실패하는 단위(기기)가 다르다.
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
    private static final int TOO_MANY_REQUESTS = 429;

    /** 스레드 이름을 붙이기 위한 것. 스택 트레이스에서 어느 층인지 바로 보인다. */
    private static final AtomicInteger CRYPTO_THREAD_SEQ = new AtomicInteger();

    /** 한 기기의 결과를 어떻게 다룰지. */
    private enum Verdict {
        /** 2xx. <b>다시 보내지 않는다</b> — 다시 보내면 그 기기가 두 번 운다. */
        DELIVERED,
        /** 404·410. 구독이 영영 끝났다. 지운다. */
        EXPIRED,
        /** 429·5xx·응답 없음. 잠시 뒤면 될 수 있다. */
        RETRY,
        /** 나머지 4xx(400 잘못된 요청, 413 본문 초과 등). 다시 해도 같다. */
        REJECTED
    }

    private static Verdict verdictOf(int status) {
        if (status >= 200 && status < 300) {
            return Verdict.DELIVERED;
        }
        if (status == GONE || status == NOT_FOUND) {
            return Verdict.EXPIRED;
        }
        // 응답을 못 받은 것(-1)은 상대가 거절한 것이 아니라 도달하지 못한 것이다.
        if (status < 0 || status == TOO_MANY_REQUESTS || status >= 500) {
            return Verdict.RETRY;
        }
        return Verdict.REJECTED;
    }

    private final PushSubscriptionRepository repository;
    private final PushService pushService;
    private final WebPushHttpClient httpClient;
    private final Semaphore inFlight;
    /**
     * 암호화 전용 풀. <b>CPU 바운드라 코어 수를 넘겨도 의미가 없다</b> — 실측으로 4코어에서
     * 스레드 8개가 4개보다 7% 빠를 뿐이다(초당 475 대 444건).
     *
     * <p>세마포어를 <b>암호화를 넘기기 전에</b> 잡으므로 이 풀의 대기열도 함께 묶인다. 안 그러면
     * HTTP는 상한에 걸려 있는데 암호화 대기열만 무한정 자란다.
     */
    private final ExecutorService cryptoPool;
    private final Duration batchTimeout;
    private final int maxAttempts;
    private final Duration retryBackoff;
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
                         @Value("${notification.web-push.batch-timeout-ms:60000}") long batchTimeoutMs,
                         @Value("${notification.web-push.max-attempts:3}") int maxAttempts,
                         @Value("${notification.web-push.retry-backoff-ms:500}") long retryBackoffMs,
                         @Value("${notification.web-push.streams-per-connection:100}") int streamsPerConnection,
                         @Value("${notification.web-push.crypto-threads:0}") int cryptoThreads) {
        this.repository = repository;
        this.pushService = createPushService(properties);
        /*
         * 연결 수를 짐작하지 않고 동시 상한에서 **계산한다**. 연결 하나가 소화하는 동시 스트림은
         * 서버가 정하고(실측 100), 그보다 많이 보내려면 연결이 더 있어야 한다 — 두 숫자를 따로
         * 두면 상한만 올리고 연결은 그대로여서 조용히 100에서 막힌다.
         */
        int connections = WebPushHttpClient.connectionsFor(maxInFlight, streamsPerConnection);
        this.httpClient = new WebPushHttpClient(
                Duration.ofMillis(connectTimeoutMs), Duration.ofMillis(requestTimeoutMs), connections);
        this.inFlight = new Semaphore(maxInFlight);
        this.batchTimeout = Duration.ofMillis(batchTimeoutMs);
        this.maxAttempts = Math.max(1, maxAttempts);
        this.retryBackoff = Duration.ofMillis(retryBackoffMs);
        int threads = cryptoThreads > 0 ? cryptoThreads : Runtime.getRuntime().availableProcessors();
        this.cryptoPool = Executors.newFixedThreadPool(threads, runnable -> {
            Thread thread = new Thread(runnable, "push-crypto-" + CRYPTO_THREAD_SEQ.getAndIncrement());
            // 데몬으로 둔다 — 종료를 막을 이유가 없다. 못 보낸 푸시는 알림함에 남아 있다.
            thread.setDaemon(true);
            return thread;
        });
        log.info("웹 푸시 암호화 스레드 {}개 (코어 {})", threads, Runtime.getRuntime().availableProcessors());
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

        long startedAt = System.nanoTime();
        List<Outcome> outcomes = dispatchWithRetries(subscriptions, payload);
        applyOutcomes(outcomes);
        logBatch(subscriptions.size(), outcomes, (System.nanoTime() - startedAt) / 1_000_000);
    }

    /**
     * <b>INFO로 남긴다.</b> 이 층은 운영에서만 진짜로 동작하고(로컬엔 VAPID 키가 없다), 결과가
     * 안 보이면 "푸시가 안 왔다"는 신고가 들어왔을 때 <b>보낸 적이 있는지조차</b> 알 수 없다.
     *
     * <p>걸린 시간을 함께 남긴다 — 이 조각이 큐 소비자를 붙잡고 있던 시간이 그대로 이 값이다.
     */
    private void logBatch(int devices, List<Outcome> outcomes, long elapsedMs) {
        int delivered = 0;
        int expired = 0;
        int failed = 0;
        for (Outcome outcome : outcomes) {
            switch (verdictOf(outcome.status())) {
                case DELIVERED -> delivered++;
                case EXPIRED -> expired++;
                case RETRY, REJECTED -> failed++;
            }
        }
        // 응답을 못 받고 마감에 걸린 것까지 세야 "몇 대에 보내려 했는지"와 맞는다.
        int abandoned = devices - outcomes.size();
        log.info("푸시 배치 기기={} 성공={} 만료정리={} 실패={} 미완={} {}ms",
                devices, delivered, expired, failed, abandoned, elapsedMs);
    }

    private List<PushSubscription> loadSubscriptions(Collection<UUID> recipientIds) {
        // 사람마다 조회하면 조각 크기만큼 왕복이 생긴다 — 한 번에 가져온다.
        return readTx.execute(status -> repository.findByUserIdIn(recipientIds));
    }

    /**
     * 물결을 여러 번 친다. <b>두 번째 물결에는 실패한 기기만 담긴다.</b>
     *
     * <p>기기마다 마지막 결과가 최종 결과다 — 2차에서 성공하면 그것이 이긴다.
     *
     * <p>전체를 {@link #batchTimeout} 안에 끝낸다. 남은 시간이 없으면 <b>재시도하지 않고 끝낸다</b> —
     * 조각 하나가 큐 소비자를 무한정 붙잡으면 뒤에 선 다른 알림이 그만큼 늦는다.
     */
    private List<Outcome> dispatchWithRetries(List<PushSubscription> subscriptions, byte[] payload) {
        long deadline = System.nanoTime() + batchTimeout.toNanos();
        // 구독 id로 모은다 — 같은 기기가 물결마다 결과를 하나씩 내므로 마지막 것만 남겨야 한다.
        Map<UUID, Outcome> latest = new LinkedHashMap<>();
        List<PushSubscription> pending = subscriptions;

        for (int attempt = 1; ; attempt++) {
            for (Outcome outcome : dispatch(pending, payload, remaining(deadline))) {
                latest.put(outcome.subscription().getId(), outcome);
            }
            if (attempt >= maxAttempts) {
                break;
            }
            /*
             * 다음 물결 대상은 **RETRY 판정을 받은 것만**이다. DELIVERED는 여기에 들어올 수 없고,
             * 그래서 한 기기가 두 번 울 수 없다 — 이 층에서 지켜야 할 단 하나의 불변식이다.
             */
            List<PushSubscription> retryable = new ArrayList<>();
            Duration askedToWait = null;
            for (PushSubscription subscription : pending) {
                Outcome outcome = latest.get(subscription.getId());
                if (outcome == null || verdictOf(outcome.status()) != Verdict.RETRY) {
                    continue;
                }
                retryable.add(subscription);
                // 상대가 시각을 알려 줬으면 그 말을 듣는다. 여럿이면 가장 늦은 쪽에 맞춘다.
                if (outcome.retryAfter() != null
                        && (askedToWait == null || outcome.retryAfter().compareTo(askedToWait) > 0)) {
                    askedToWait = outcome.retryAfter();
                }
            }
            if (retryable.isEmpty() || !sleepBeforeRetry(askedToWait, attempt, deadline)) {
                break;
            }
            log.debug("푸시 재시도 물결 attempt={} 대상={}", attempt + 1, retryable.size());
            pending = retryable;
        }
        return List.copyOf(latest.values());
    }

    /**
     * 다음 물결까지 기다린다. 기다릴 시간이 남지 않았으면 {@code false}를 주고 거기서 끝낸다.
     *
     * <p>{@code Retry-After}가 남은 시간보다 길면 <b>기다리지 않는다</b> — 어차피 그 안에 못 끝낸다.
     */
    private boolean sleepBeforeRetry(Duration askedToWait, int attempt, long deadline) {
        // 지수 백오프. 상대가 말해 줬으면 그 값이 우선이다 — 우리 추측보다 정확하다.
        Duration wait = askedToWait != null
                ? askedToWait
                : retryBackoff.multipliedBy(1L << (attempt - 1));
        Duration left = remaining(deadline);
        if (left.isZero() || wait.compareTo(left) > 0) {
            log.debug("푸시 재시도를 접는다 — 대기={}ms 남은시간={}ms", wait.toMillis(), left.toMillis());
            return false;
        }
        try {
            Thread.sleep(wait.toMillis());
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private static Duration remaining(long deadline) {
        long left = deadline - System.nanoTime();
        return left <= 0 ? Duration.ZERO : Duration.ofNanos(left);
    }

    /**
     * 전부 띄우고 전부 기다린다. <b>트랜잭션 밖</b>이라 DB 커넥션을 붙잡지 않는다.
     *
     * <p>세마포어는 <b>제출 시점</b>에 잡고 <b>완료 시점</b>에 놓는다. 그래서 in-flight가 상한을
     * 넘지 않고, 느린 푸시 서비스가 있어도 그쪽으로만 몰릴 뿐 전체가 멈추지 않는다.
     */
    private List<Outcome> dispatch(List<PushSubscription> subscriptions, byte[] payload, Duration budget) {
        List<CompletableFuture<Outcome>> futures = new ArrayList<>(subscriptions.size());
        for (PushSubscription subscription : subscriptions) {
            futures.add(sendOne(subscription, payload));
        }
        try {
            CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
                    .get(Math.max(1, budget.toMillis()), java.util.concurrent.TimeUnit.MILLISECONDS);
        } catch (Exception e) {
            /*
             * 조각 전체가 늦어도 여기서 멈추지 않는다. 끝난 것만 반영하고 나머지는 버린다 —
             * 푸시는 못 받아도 알림함에 남아 있고, 여기서 예외를 올리면 워커가 조각 전체를 재시도해
             * 알림 행은 중복 제거에 걸리고 **푸시는 아무에게도 가지 않는다**.
             */
            log.warn("푸시 물결이 제한 시간 안에 끝나지 않았습니다 — 완료분만 반영합니다: {}", e.toString());
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
            return CompletableFuture.completedFuture(new Outcome(subscription, -1, null));
        }
        // 암호화(RFC 8291)와 VAPID 서명(RFC 8292)은 라이브러리가 한다. 우리는 실어 보내기만.
        return CompletableFuture
                .supplyAsync(() -> encrypt(subscription, payload), cryptoPool)
                /*
                 * 암호화가 끝난 스레드가 그대로 요청을 띄운다. 여기서 스레드를 갈아탈 이유가 없다 —
                 * 전송은 비동기라 이 스레드를 붙잡지 않는다.
                 */
                .thenCompose(httpClient::send)
                .handle((response, error) -> {
                    if (error != null) {
                        /*
                         * 암호화 실패와 전송 실패를 함께 받는다. 어느 쪽이든 그 기기 하나의 문제이고,
                         * 나머지 기기는 계속 보낸다.
                         */
                        log.warn("푸시 발송 오류 id={}: {}", subscription.getId(), error.toString());
                        return new Outcome(subscription, -1, null);
                    }
                    return new Outcome(subscription, response.status(), response.retryAfter());
                })
                .whenComplete((ignored, ignoredError) -> inFlight.release());
    }

    /**
     * 암호화 풀에서 도는 부분. 검사 예외를 비검사로 감싼다 — 어차피 {@code handle}이 받아서
     * 그 기기 하나의 실패로 처리하고, 나머지 기기는 계속 간다.
     */
    private org.apache.http.client.methods.HttpPost encrypt(PushSubscription subscription, byte[] payload) {
        try {
            return pushService.preparePost(new Notification(
                            subscription.getEndpoint(), subscription.getP256dh(),
                            subscription.getAuth(), payload),
                    nl.martijndwars.webpush.Encoding.AES128GCM);
        } catch (Exception e) {
            // 여기 오는 건 그 구독의 키가 깨졌다는 뜻이다.
            throw new IllegalStateException("푸시 요청 생성 실패 id=" + subscription.getId(), e);
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
        List<PushSubscription> delivered = new ArrayList<>();
        OffsetDateTime now = OffsetDateTime.now();
        for (Outcome outcome : outcomes) {
            switch (verdictOf(outcome.status())) {
                case DELIVERED -> {
                    outcome.subscription().setLastSuccessAt(now);
                    delivered.add(outcome.subscription());
                }
                case EXPIRED -> dead.add(outcome.subscription());
                // 여기까지 왔다는 건 재시도를 다 썼거나 시간이 없었다는 뜻이다.
                case RETRY, REJECTED -> log.warn("푸시 발송 실패 status={} id={}",
                        outcome.status(), outcome.subscription().getId());
            }
        }
        if (!dead.isEmpty()) {
            repository.deleteAll(dead);
            log.info("죽은 푸시 구독 {}건 정리", dead.size());
        }
        if (!delivered.isEmpty()) {
            repository.saveAll(delivered);
        }
    }

    /**
     * 기기 하나의 결과. {@code status < 0}은 응답을 못 받았다는 뜻이다(오류·타임아웃).
     *
     * <p>{@code retryAfter}는 상대가 알려 줬을 때만 있다(429의 {@code Retry-After}).
     */
    record Outcome(PushSubscription subscription, int status, Duration retryAfter) {
    }
}
