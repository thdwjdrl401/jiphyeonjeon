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
 * <p>STOMP 신호와 다른 층이다. STOMP는 탭이 열려 있어야 닿고, Web Push는 탭을 닫아도 닿는다.
 *
 * <p>Web Push에는 배치가 없다. 표준에 기기 여러 대를 한 요청으로 보내는 방법이 없어서
 * 구독 수만큼 HTTPS를 쳐야 한다. 그래서 이 층의 과제는 요청 수를 줄이는 것이 아니라
 * 많은 요청을 겹쳐서, 다른 일을 막지 않고 보내는 것이다.
 *
 * <ul>
 *   <li>공유 클라이언트: 연결을 재사용한다({@link WebPushHttpClient}에 이유가 있다).</li>
 *   <li>동시 상한: 세마포어로 in-flight를 묶는다. 묶지 않으면 조각 하나가 기기 수천 대일 때
 *       요청이 한꺼번에 나가 푸시 서비스가 429로 막고, 펜딩 객체가 메모리에 쌓인다.</li>
 *   <li>DB 반영은 마지막에 한 번: 발송 중에는 엔티티를 건드리지 않는다. HTTP를 기다리는 동안
 *       트랜잭션이 열려 있으면 커넥션을 그만큼 점유한다.</li>
 * </ul>
 *
 * <p>암호화는 별도 풀에서 한다. {@code preparePost}는 순수 CPU 작업이다(ECDH + HKDF + AES-GCM +
 * VAPID 서명). 큐 소비자 스레드가 이를 순서대로 하면 제출 속도가 암호화 속도에 묶여 HTTP를
 * 아무리 겹쳐도 그 이상 나가지 못하므로 전용 풀에 넘긴다. 암호화 병렬화와 연결 수는 함께
 * 늘려야 한다. 한쪽만 늘리면 다른 쪽이 상한이 된다. 측정값은 {@code docs/benchmark/README.md}의
 * "암호화 전용 풀" 절에 있다. 같은 함수를 다른 스레드에서 부를 뿐이므로 계산 결과는 달라지지 않는다.
 *
 * <p>재시도는 기기 단위다. 조각을 통째로 다시 보내면 이미 받은 사람에게 알림이 중복된다.
 * Web Push에는 멱등 키가 없어서 같은 endpoint로 두 번 POST하면 기기에 알림이 두 번 표시된다.
 * 어느 기기가 실패했는지는 결과에 남아 있으므로 실패한 것만 다시 보내면 중복이 없다.
 * 성공(2xx)한 구독은 두 번째 회차에 들어가지 않는다. 이 층이 지키는 조건은 이것이다.
 *
 * <p>큐 재배달은 이 일을 대신하지 못한다. 진행 표(ADR-0124)는 재배달을 사람 단위로는
 * 안전하게 만들지만, 한 사람을 다시 보내면 그 사람이 이미 받은 기기에도 알림이 다시 간다.
 * 재시도할 수 있는 단위(사람)와 실패하는 단위(기기)가 다르므로 기기 단위 회차는 이 호출 안에서 끝낸다.
 *
 * <p>404·410 구독은 즉시 지운다. 브라우저를 지웠거나 권한을 꺼서 다시 쓸 수 없는 구독이다.
 * 남겨 두면 시간이 갈수록 발송의 대부분이 만료된 구독으로 나간다.
 *
 * <p>VAPID 키가 없으면 푸시를 보내지 않고 넘어간다. 로컬·테스트에서는 키를 만들 이유가 없고,
 * 푸시는 알림함 위에 얹는 층이라 키가 없다고 알림 자체가 멈추면 안 된다.
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
        /** 2xx. 다시 보내지 않는다. 다시 보내면 그 기기에 알림이 두 번 표시된다. */
        DELIVERED,
        /** 404·410. 구독이 만료됐다. 지운다. */
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
    /** 동시 상한의 최댓값·최솟값과 지금 값. 조절기가 이 사이를 오간다. */
    private final int inFlightCeiling;
    private final int inFlightFloor;
    private final int inFlightStep;
    private final boolean adaptiveInFlight;
    private final Object limitLock = new Object();
    private int inFlightLimit;
    /**
     * 암호화 전용 풀. CPU 바운드라 코어 수를 넘겨도 효과가 없다
     * (측정: {@code docs/benchmark/README.md} "암호화 전용 풀").
     *
     * <p>세마포어를 암호화를 넘기기 전에 잡으므로 이 풀의 대기열도 함께 묶인다. 그렇지 않으면
     * HTTP는 상한에 걸려 있는데 암호화 대기열만 무한정 자란다.
     */
    private final ExecutorService cryptoPool;
    private final Duration batchTimeout;
    private final int maxAttempts;
    private final Duration retryBackoff;
    /*
     * 트랜잭션을 애너테이션이 아니라 코드에서 직접 연다. 같은 클래스 안에서 부르는 메서드에
     * @Transactional을 달면 프록시를 거치지 않아 적용되지 않는다. 트랜잭션 경계를 발송 앞뒤의
     * 짧은 구간으로 제한해야 하므로 경계를 코드에서 명시한다.
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
         * 연결 수를 짐작하지 않고 동시 상한에서 계산한다. 연결 하나가 소화하는 동시 스트림은
         * 서버가 정하고(실측 100), 그보다 많이 보내려면 연결이 더 있어야 한다. 두 숫자를 따로
         * 두면 상한만 올라가고 연결은 그대로여서 100에서 막힌다.
         */
        int connections = WebPushHttpClient.connectionsFor(maxInFlight, streamsPerConnection);
        this.httpClient = new WebPushHttpClient(
                Duration.ofMillis(connectTimeoutMs), Duration.ofMillis(requestTimeoutMs), connections);
        /*
         * 동시 상한은 공급자 반응으로 조절한다. 목 서버로는 적정값을 찾을 수 없다. 속도 제한이
         * 없어서 올리는 만큼 빨라지고(800 → 2,400에서 +20%), 그 값을 실제 공급자에게 쓰면
         * 429를 맞는다. 그래서 막히면 줄이고 안 막히면 늘린다(ADR-0137).
         *
         * max-in-flight는 시작값이자 최댓값이다. 조각 하나가 429·5xx로 끝나면 절반으로
         * 줄이고(최솟값은 min-in-flight), 깨끗하게 끝나면 최댓값의 1/16씩 되올린다. 연결 수는
         * 최댓값에 맞춰 잡아 둔다. 줄었다 늘 때 새로 열 필요가 없다.
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
            // 데몬 스레드로 둔다. 종료를 막을 이유가 없다. 못 보낸 푸시는 알림함에 남아 있다.
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
     * 이 사람들의 모든 기기로 보낸다.
     *
     * <p>단계가 셋이고 가운데 단계에만 시간이 든다. 구독 조회(짧은 읽기) → 병렬 발송(HTTP,
     * 트랜잭션 밖) → 결과 반영(짧은 쓰기).
     *
     * @return 명단을 끝난 사람과 안 끝난 사람으로 가른 것(ADR-0124, ADR-0128).
     *         <ul>
     *           <li>끝남, 그 사람의 모든 기기가 최종 판정을 냈다(성공·구독 만료·영구 거절).
     *               구독이 하나도 없는 사람도 여기 들어간다(보낼 곳이 없으니 끝났다).</li>
     *           <li>안 끝남, 429·5xx로 막혔거나 batch-timeout·인터럽트로 응답을 못 본 기기가
     *               하나라도 있다. 이들을 진행 표에 기록하면 영구 유실이다. 호출자가
     *               다시 실어야 한다.</li>
     *         </ul>
     */
    public SendResult send(Collection<UUID> recipientIds, String title, String body, String url) {
        if (recipientIds.isEmpty()) {
            return SendResult.nothingToDo();
        }
        if (!isEnabled()) {
            /*
             * 키가 없으면 보낼 것이 없다. 전원 "시도를 마쳤다"로 친다. 빈 집합을 돌려주면 진행
             * 표가 차지 않아, 꺼져 있는 푸시 때문에 재배달이 같은 명단을 계속 다시 집는다.
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
     * @param unfinished 아직 못 보낸 사람들. 429·5xx로 막혔거나 응답을 못 본 기기가 있다.
     *                   기록하면 영구 유실이므로 기록하지 않고, 호출자가 다시 실어야 한다.
     * @param retryAfter 푸시 서비스가 알려 준 대기 시간 중 가장 긴 것. 없으면 {@code null},
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
     * 시도를 마친 사람과 아직 안 끝난 사람을 가른다.
     *
     * <p>기준은 판정이다. 최종 판정(성공·구독 만료·영구 거절)만 끝난 것으로 치고,
     * {@code RETRY} 판정(429·5xx)과 응답을 못 본 기기는 안 끝난 것으로 남긴다. 한 사람의 기기
     * 하나라도 안 끝났으면 그 사람은 안 끝난 쪽이다. 429는 "속도를 줄여라"라는 응답이지 발송
     * 완료가 아니므로, 429로 제한 시간이 끝난 기기를 끝난 것으로 기록하면 anti-join이 그 사람을
     * 계속 제외한다(ADR-0128).
     *
     * <p>이 기준 때문에 한 사람의 기기 하나에 알림이 두 번 갈 수 있다. 기기 A는 성공하고 기기 B가
     * 429로 남으면 그 사람을 다시 보내게 되고, 이때 A에도 알림이 다시 간다. 진행 표가 사람 단위라서
     * 그렇다. 반대쪽은 아예 받지 못하는 경우이고, 이 프로젝트는 같은 갈림길에서 "오류 없이 생기는
     * 유실보다 가끔 두 번 발송"을 택했다(ADR-0124). 기기 단위로 진행을 기록하면 중복도 없어지지만
     * 표 구조를 바꿔야 한다.
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
     * INFO로 남긴다. 이 층은 운영에서만 진짜로 동작하고(로컬엔 VAPID 키가 없다), 결과가
     * 안 보이면 "푸시가 안 왔다"는 신고가 들어왔을 때 보낸 적이 있는지조차 알 수 없다.
     *
     * <p>걸린 시간을 함께 남긴다. 이 조각이 큐 소비자를 붙잡고 있던 시간이 그대로 이 값이다.
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
        // 사람마다 조회하면 조각 크기만큼 왕복이 생긴다. 한 번에 가져온다.
        return readTx.execute(status -> repository.findAllByUserIds(recipientIds.toArray(UUID[]::new)));
    }

    /**
     * 회차를 여러 번 돈다. 두 번째 회차에는 실패한 기기만 담긴다.
     *
     * <p>기기마다 마지막 결과가 최종 결과다. 2차에서 성공하면 그것이 이긴다.
     *
     * <p>전체를 {@link #batchTimeout} 안에 끝낸다. 남은 시간이 없으면 재시도하지 않고 끝낸다.
     * 조각 하나가 큐 소비자를 무한정 붙잡으면 뒤에 선 다른 알림이 그만큼 늦는다.
     */
    private List<Outcome> dispatchWithRetries(List<PushSubscription> subscriptions, byte[] payload) {
        long deadline = System.nanoTime() + batchTimeout.toNanos();
        // 구독 id로 모은다. 같은 기기가 회차마다 결과를 하나씩 내므로 마지막 것만 남겨야 한다.
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
             * 다음 회차 대상은 RETRY 판정을 받은 것만이다. DELIVERED는 여기에 들어올 수 없으므로
             * 한 기기에 알림이 두 번 가지 않는다. 이 층이 지켜야 할 조건은 이것 하나다.
             */
            List<PushSubscription> retryable = new ArrayList<>();
            Duration askedToWait = null;
            for (PushSubscription subscription : pending) {
                Outcome outcome = latest.get(subscription.getId());
                if (outcome == null || verdictOf(outcome.status()) != Verdict.RETRY) {
                    continue;
                }
                retryable.add(subscription);
                // 공급자가 시각을 알려 줬으면 그 값을 따른다. 여럿이면 가장 늦은 쪽에 맞춘다.
                if (outcome.retryAfter() != null
                        && (askedToWait == null || outcome.retryAfter().compareTo(askedToWait) > 0)) {
                    askedToWait = outcome.retryAfter();
                }
            }
            if (retryable.isEmpty() || !sleepBeforeRetry(askedToWait, attempt, deadline)) {
                break;
            }
            log.debug("푸시 재시도 회차 attempt={} 대상={}", attempt + 1, retryable.size());
            pending = retryable;
        }
        return List.copyOf(latest.values());
    }

    /**
     * 다음 회차까지 기다린다. 기다릴 시간이 남지 않았으면 {@code false}를 주고 거기서 끝낸다.
     *
     * <p>{@code Retry-After}가 남은 시간보다 길면 기다리지 않는다. 어차피 그 안에 못 끝낸다.
     */
    private boolean sleepBeforeRetry(Duration askedToWait, int attempt, long deadline) {
        // 지수 백오프. 공급자가 알려 준 값이 있으면 그 값이 우선이다. 추정한 백오프보다 정확하다.
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
     * 전부 띄우고 전부 기다린다. 트랜잭션 밖이라 DB 커넥션을 붙잡지 않는다.
     *
     * <p>세마포어는 제출 시점에 잡고 완료 시점에 놓는다. 그래서 in-flight가 상한을
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
             * 조각 전체가 늦어도 여기서 멈추지 않는다. 끝난 것만 반영하고 나머지는 버린다.
             * 푸시는 못 받아도 알림함에 남아 있고, 여기서 예외를 올리면 워커가 조각 전체를 재시도해
             * 알림 행은 중복 제거에 걸리고 푸시는 아무에게도 가지 않는다.
             */
            log.warn("푸시 회차가 제한 시간 안에 끝나지 않았습니다 — 완료분만 반영합니다: {}", e.toString());
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
                 * 암호화가 끝난 스레드가 그대로 요청을 띄운다. 여기서 스레드를 갈아탈 이유가 없다.
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
     * 암호화 풀에서 도는 부분. 검사 예외를 비검사로 감싼다. 어차피 {@code handle}이 받아서
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
     * <p>신호는 조각 안 재시도까지 다 쓰고도 남은 RETRY다. 그 안에서 429를 맞았다가 다시
     * 보내 성공했다면 공급자가 견딘 것이므로 줄일 이유가 없다. 끝까지 막힌 기기가 하나라도 있으면
     * 그때 줄인다.
     *
     * <p>줄일 때는 절반, 늘릴 때는 최댓값의 1/16씩이다. 막히는 쪽에 빠르게 반응하고 푸는 쪽은
     * 천천히, 반대로 하면 상한 근처에서 429를 반복해서 맞는다.
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
            log.info("동시 상한 {} → {} ({}, 최대 {} 최소 {})",
                    now, next, pushedBack ? "공급자가 막았다" : "깨끗했다",
                    inFlightCeiling, inFlightFloor);
        }
    }

    /**
     * 다음 동시 상한. 줄일 때는 절반, 늘릴 때는 한 걸음씩이다.
     *
     * <p>비대칭인 이유는 틀렸을 때의 값이 다르기 때문이다. 너무 높으면 공급자가 거절하고 그
     * 사람들은 다음 회차까지 못 받는다. 너무 낮으면 조금 느릴 뿐이다. 그래서 막히는 쪽으로는
     * 빠르게, 푸는 쪽으로는 천천히 움직인다.
     *
     * <p>산술만 떼어 둔다. 세마포어와 잠금이 붙어 있으면 경계값을 확인하기 어렵다.
     */
    static int nextInFlight(int now, boolean pushedBack, int ceiling, int floor, int step) {
        return pushedBack
                ? Math.max(floor, now / 2)
                : Math.min(ceiling, now + step);
    }

    /**
     * 허가 수를 줄일 수 있는 세마포어. {@code reducePermits}가 protected라 열어 준다.
     *
     * <p>줄이는 것은 지금 나가 있는 요청을 취소하지 않는다. 이미 나간 것은 그대로 끝나고,
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

    /** 발송이 다 끝난 뒤 한 번에 반영한다. HTTP를 기다리는 동안 트랜잭션을 열어 두지 않는다. */
    private void applyOutcomes(List<Outcome> outcomes) {
        if (outcomes.isEmpty()) {
            return;
        }
        writeTx.executeWithoutResult(status -> applyOutcomesInTx(outcomes));
    }

    /*
     * 둘 다 한 문장이다. deleteAll·saveAll은 행마다 문장을 만들고, saveAll은 바뀐 것이 시각 한 칸뿐인데도
     * 넓은 행 전체를 성공 수만큼 다시 쓴다. 푸시 소비자 경로가 조각(≤1,000명 × 기기 수)마다 이
     * 코드를 지나므로 행 단위 문장은 그 곱이 그대로 DB 부하가 된다.
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
