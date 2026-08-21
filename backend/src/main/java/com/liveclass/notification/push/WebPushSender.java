package com.liveclass.notification.push;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
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
 * <p>큐 재배달은 이 일을 대신하지 못한다. 진행 표(ADR-0124)가 재배달을 <b>사람</b> 단위로는
 * 안전하게 만들었지만, 한 사람을 다시 보내는 것은 그 사람의 <b>이미 받은 기기</b>까지 다시
 * 울리는 일이다. 재시도할 수 있는 단위(사람)와 실패하는 단위(기기)가 여전히 다르므로, 기기 단위
 * 물결은 이 호출 안에서 끝낸다.
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
    private final WebPushRequestFactory requests;
    private final WebPushHttpClient httpClient;
    private final AdjustableSemaphore inFlight;
    /** 동시 상한의 천장·바닥과 지금 값. 조절기가 이 사이를 오간다. */
    private final int inFlightCeiling;
    private final int inFlightFloor;
    private final int inFlightStep;
    private final boolean adaptiveInFlight;
    private final Object limitLock = new Object();
    private int inFlightLimit;
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
                         @Value("${notification.web-push.crypto-threads:0}") int cryptoThreads,
                         @Value("${notification.web-push.min-in-flight:100}") int minInFlight,
                         @Value("${notification.web-push.adaptive-in-flight:true}") boolean adaptiveInFlight) {
        this.repository = repository;
        this.requests = properties.isConfigured() ? new WebPushRequestFactory(properties) : null;
        /*
         * 연결 수를 짐작하지 않고 동시 상한에서 **계산한다**. 연결 하나가 소화하는 동시 스트림은
         * 서버가 정하고(실측 100), 그보다 많이 보내려면 연결이 더 있어야 한다 — 두 숫자를 따로
         * 두면 상한만 올리고 연결은 그대로여서 조용히 100에서 막힌다.
         */
        int connections = WebPushHttpClient.connectionsFor(maxInFlight, streamsPerConnection);
        this.httpClient = new WebPushHttpClient(
                Duration.ofMillis(connectTimeoutMs), Duration.ofMillis(requestTimeoutMs), connections);
        /*
         * **동시 상한은 공급자가 정하게 둔다.** 목 서버로는 옳은 값을 못 찾는다 — 속도 제한이
         * 없어서 올리는 만큼 빨라지고(800 → 2,400에서 +20%), 그 값을 그대로 실제 공급자에게
         * 쓰면 429를 맞는다. 그래서 짐작하지 않고 **막히면 줄이고 안 막히면 늘린다**(ADR-0137).
         *
         * max-in-flight는 이제 시작값이자 천장이다. 조각 하나가 429·5xx로 끝나면 절반으로
         * 줄이고(바닥은 min-in-flight), 깨끗하게 끝나면 천장의 1/16씩 되올린다. 연결 수는
         * 천장에 맞춰 잡아 둔다 — 줄었다 늘 때 새로 열 필요가 없다.
         */
        this.inFlightCeiling = Math.max(1, maxInFlight);
        this.inFlightFloor = Math.max(1, Math.min(minInFlight, this.inFlightCeiling));
        this.inFlightStep = Math.max(1, this.inFlightCeiling / 16);
        this.adaptiveInFlight = adaptiveInFlight;
        this.inFlightLimit = this.inFlightCeiling;
        this.inFlight = new AdjustableSemaphore(this.inFlightCeiling);
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

    public boolean isEnabled() {
        return requests != null;
    }

    /**
     * 이 사람들의 <b>모든 기기</b>로 보낸다.
     *
     * <p>단계가 셋이고 <b>가운데 단계에만 시간이 든다</b> — 구독 조회(짧은 읽기) → 병렬 발송(HTTP,
     * 트랜잭션 밖) → 결과 반영(짧은 쓰기).
     *
     * @return 명단을 <b>끝난 사람과 안 끝난 사람으로 가른 것</b>(ADR-0124, ADR-0128).
     *         <ul>
     *           <li>끝남 — 그 사람의 모든 기기가 <b>최종 판정</b>을 냈다(성공·구독 만료·영구 거절).
     *               구독이 하나도 없는 사람도 여기 들어간다(보낼 곳이 없으니 끝났다).</li>
     *           <li>안 끝남 — 429·5xx로 막혔거나 batch-timeout·인터럽트로 응답을 못 본 기기가
     *               하나라도 있다. <b>이들을 진행 표에 기록하면 영구 유실이다</b> — 호출자가
     *               다시 실어야 한다.</li>
     *         </ul>
     */
    public SendResult send(Collection<UUID> recipientIds, String title, String body, String url) {
        if (recipientIds.isEmpty()) {
            return SendResult.nothingToDo();
        }
        if (!isEnabled()) {
            /*
             * 키가 없으면 보낼 것이 없다 — 전원 "시도를 마쳤다"로 친다. 빈 집합을 돌려주면 진행
             * 표가 영영 차지 않아, 켜 있지도 않은 푸시 때문에 재배달이 같은 명단을 계속 다시 집는다.
             */
            return SendResult.allSettled(recipientIds);
        }
        List<PushSubscription> subscriptions = loadSubscriptions(recipientIds);
        if (subscriptions.isEmpty()) {
            return SendResult.allSettled(recipientIds);
        }
        byte[] payload = PushPayload.json(title, body, url)
                .getBytes(java.nio.charset.StandardCharsets.UTF_8);

        long startedAt = System.nanoTime();
        List<Outcome> outcomes = dispatchWithRetries(subscriptions, payload);
        adjustInFlight(outcomes);
        applyOutcomes(outcomes);
        logBatch(subscriptions.size(), outcomes, (System.nanoTime() - startedAt) / 1_000_000);
        Split split = splitByCompletion(recipientIds, subscriptions, outcomes);
        return new SendResult(Set.copyOf(split.settled()), Set.copyOf(split.unfinished()), split.retryAfter());
    }

    /**
     * 이번 호출의 결말.
     *
     * @param settled    시도가 끝난 사람들. 진행 표에 기록해 다시 보내지 않는다.
     * @param unfinished <b>아직 못 보낸</b> 사람들. 429·5xx로 막혔거나 응답을 못 본 기기가 있다.
     *                   기록하면 영구 유실이므로 기록하지 않고, 호출자가 다시 실어야 한다.
     * @param retryAfter 푸시 서비스가 알려 준 대기 시간 중 가장 긴 것. 없으면 {@code null} —
     *                   그때는 호출자가 자기 백오프를 쓴다.
     */
    public record SendResult(Set<UUID> settled, Set<UUID> unfinished, Duration retryAfter) {

        static SendResult nothingToDo() {
            return new SendResult(Set.of(), Set.of(), null);
        }

        static SendResult allSettled(Collection<UUID> recipientIds) {
            return new SendResult(Set.copyOf(recipientIds), Set.of(), null);
        }
    }

    /**
     * 시도를 마친 사람과 <b>아직 안 끝난 사람</b>을 가른다.
     *
     * <p>전에는 결과의 유무만 봤다 — 응답이 왔으면 내용을 보지 않고 "시도를 마쳤다"로 쳤다.
     * 그래서 <b>429를 받고 제한 시간이 끝난 기기</b>도 마친 것이 되어 진행 표에 기록됐고, 그 뒤로는
     * anti-join이 그 사람을 영영 걸러 냈다. 푸시 서비스가 "속도를 줄여라"라고 답한 것을 "보냈다"로
     * 기록한 셈이고, 결과는 조용한 영구 유실이었다(ADR-0128).
     *
     * <p>기준은 <b>판정</b>이다. 최종 판정(성공·구독 만료·영구 거절)만 끝난 것으로 치고,
     * {@code RETRY} 판정(429·5xx)과 응답을 못 본 기기는 안 끝난 것으로 남긴다. 한 사람의 기기
     * 하나라도 안 끝났으면 그 사람은 안 끝난 쪽이다.
     *
     * <p><b>이 갈라놓기가 곧 "그 사람의 기기 하나가 두 번 울 수 있다"를 뜻한다.</b> 기기 A는
     * 성공하고 기기 B가 429로 남으면 그 사람을 다시 보내게 되고, 그때 A도 다시 울린다. 진행 표가
     * 사람 단위라서 그렇다. 그래도 이쪽을 고른 이유는 반대쪽이 "아예 못 받는다"이기 때문이고,
     * 이 프로젝트는 같은 갈림길에서 이미 "조용한 유실보다 가끔 두 번"을 골랐다(ADR-0124).
     * 기기 단위로 진행을 기록하면 그 두 번도 사라지지만, 그건 표 구조를 바꾸는 일이다.
     */
    private static Split splitByCompletion(Collection<UUID> recipientIds,
                                           List<PushSubscription> subscriptions,
                                           List<Outcome> outcomes) {
        Map<UUID, Outcome> byDevice = HashMap.newHashMap(outcomes.size());
        for (Outcome outcome : outcomes) {
            byDevice.put(outcome.subscription().getId(), outcome);
        }
        Set<UUID> unfinishedOwners = new HashSet<>();
        Duration askedToWait = null;
        for (PushSubscription subscription : subscriptions) {
            Outcome outcome = byDevice.get(subscription.getId());
            // 응답을 못 봤거나(null) 다시 해 볼 여지가 있는 판정이면 안 끝난 것이다.
            if (outcome == null || verdictOf(outcome.status()) == Verdict.RETRY) {
                unfinishedOwners.add(subscription.getUserId());
                if (outcome != null && outcome.retryAfter() != null
                        && (askedToWait == null || outcome.retryAfter().compareTo(askedToWait) > 0)) {
                    askedToWait = outcome.retryAfter();
                }
            }
        }
        Set<UUID> settled = new HashSet<>(recipientIds);
        settled.removeAll(unfinishedOwners);
        // 명단에 없는 사람이 섞여 들어오지 않게 교집합으로 자른다.
        unfinishedOwners.retainAll(recipientIds);
        return new Split(settled, unfinishedOwners, askedToWait);
    }

    private record Split(Set<UUID> settled, Set<UUID> unfinished, Duration retryAfter) {
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
        // 암호화(RFC 8291)와 VAPID 서명(RFC 8292)은 WebPushCrypto가 한다.
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
    private WebPushRequest encrypt(PushSubscription subscription, byte[] payload) {
        try {
            return requests.create(subscription, payload);
        } catch (Exception e) {
            // 여기 오는 건 그 구독의 키가 깨졌다는 뜻이다.
            throw new IllegalStateException("푸시 요청 생성 실패 id=" + subscription.getId(), e);
        }
    }

    /**
     * 이번 조각의 결과로 동시 상한을 옮긴다.
     *
     * <p>신호는 <b>조각 안 재시도까지 다 쓰고도 남은 RETRY</b>다. 그 안에서 429를 맞았다가 다시
     * 보내 성공했다면 공급자가 견딘 것이므로 줄일 이유가 없다. 끝까지 막힌 기기가 하나라도 있으면
     * 그때 줄인다.
     *
     * <p>줄일 때는 절반, 늘릴 때는 천장의 1/16씩이다. 막히는 쪽에 빠르게 반응하고 푸는 쪽은
     * 천천히 — 반대로 하면 상한 근처에서 429를 반복해서 맞는다.
     */
    private void adjustInFlight(List<Outcome> outcomes) {
        if (!adaptiveInFlight) {
            return;
        }
        boolean pushedBack = false;
        for (Outcome outcome : outcomes) {
            if (verdictOf(outcome.status()) == Verdict.RETRY) {
                pushedBack = true;
                break;
            }
        }
        synchronized (limitLock) {
            int now = inFlightLimit;
            int next = nextInFlight(now, pushedBack, inFlightCeiling, inFlightFloor, inFlightStep);
            if (next == now) {
                return;
            }
            if (next > now) {
                inFlight.release(next - now);
            } else {
                inFlight.take(now - next);
            }
            inFlightLimit = next;
            log.info("동시 상한 {} → {} ({}, 천장 {} 바닥 {})",
                    now, next, pushedBack ? "공급자가 막았다" : "깨끗했다",
                    inFlightCeiling, inFlightFloor);
        }
    }

    /**
     * 다음 동시 상한. <b>줄일 때는 절반, 늘릴 때는 한 걸음씩</b>이다.
     *
     * <p>비대칭인 이유는 틀렸을 때의 값이 다르기 때문이다. 너무 높으면 공급자가 거절하고 그
     * 사람들은 다음 회차까지 못 받는다. 너무 낮으면 조금 느릴 뿐이다. 그래서 막히는 쪽으로는
     * 빠르게, 푸는 쪽으로는 천천히 움직인다.
     *
     * <p>산술만 떼어 둔다 — 세마포어와 잠금이 붙어 있으면 경계값을 확인하기 어렵다.
     */
    static int nextInFlight(int now, boolean pushedBack, int ceiling, int floor, int step) {
        return pushedBack
                ? Math.max(floor, now / 2)
                : Math.min(ceiling, now + step);
    }

    /**
     * 허가 수를 줄일 수 있는 세마포어. {@code reducePermits}가 protected라 열어 준다.
     *
     * <p>줄이는 것은 <b>지금 나가 있는 요청을 취소하지 않는다</b> — 이미 나간 것은 그대로 끝나고,
     * 다음 요청부터 줄어든 수만큼만 나간다.
     */
    private static final class AdjustableSemaphore extends Semaphore {

        private AdjustableSemaphore(int permits) {
            super(permits);
        }

        private void take(int permits) {
            reducePermits(permits);
        }
    }

    /** 발송이 다 끝난 뒤 <b>한 번</b>에 반영한다. HTTP를 기다리는 동안 트랜잭션을 열어 두지 않는다. */
    private void applyOutcomes(List<Outcome> outcomes) {
        if (outcomes.isEmpty()) {
            return;
        }
        writeTx.executeWithoutResult(status -> applyOutcomesInTx(outcomes));
    }

    /*
     * 둘 다 **한 문장**이다. deleteAll·saveAll은 행마다 문장을 만든다 — saveAll은 심지어 바뀐 것이
     * 시각 한 칸뿐인데 넓은 행 전체를 성공 수만큼 다시 쓴다. 푸시 소비자 경로가 조각(≤1,000명 ×
     * 기기 수)마다 이 코드를 지나므로 그 곱이 그대로 DB 부하였다.
     */
    private void applyOutcomesInTx(List<Outcome> outcomes) {
        List<UUID> dead = new ArrayList<>();
        List<UUID> delivered = new ArrayList<>();
        for (Outcome outcome : outcomes) {
            switch (verdictOf(outcome.status())) {
                case DELIVERED -> delivered.add(outcome.subscription().getId());
                case EXPIRED -> dead.add(outcome.subscription().getId());
                // 여기까지 왔다는 건 재시도를 다 썼거나 시간이 없었다는 뜻이다.
                case RETRY, REJECTED -> log.warn("푸시 발송 실패 status={} id={}",
                        outcome.status(), outcome.subscription().getId());
            }
        }
        if (!dead.isEmpty()) {
            repository.deleteAllByIds(dead.toArray(UUID[]::new));
            log.info("죽은 푸시 구독 {}건 정리", dead.size());
        }
        if (!delivered.isEmpty()) {
            repository.markDelivered(delivered.toArray(UUID[]::new), OffsetDateTime.now());
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
