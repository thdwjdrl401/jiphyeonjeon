package com.liveclass.notification;

import com.liveclass.notification.push.PushSubscription;
import com.liveclass.notification.push.PushSubscriptionRepository;
import com.liveclass.notification.push.WebPushProperties;
import com.liveclass.notification.push.WebPushSender;
import com.sun.net.httpserver.HttpServer;
import nl.martijndwars.webpush.Utils;
import org.bouncycastle.jce.interfaces.ECPrivateKey;
import org.bouncycastle.jce.interfaces.ECPublicKey;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.net.InetSocketAddress;
import java.time.Duration;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.security.Security;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.Queue;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 푸시 재시도는 <b>기기 단위</b>다.
 *
 * <p>지켜야 할 것은 하나다 — <b>성공한 기기는 다시 보내지 않는다</b>. Web Push에는 멱등 키가 없어서
 * 같은 endpoint로 두 번 POST하면 기기가 두 번 울린다. 그래서 "조각을 통째로 다시"는 쓸 수 없고,
 * 실패한 기기만 골라 보내야 한다.
 *
 * <p>큐가 이 일을 대신할 수 없다. 진행 표(ADR-0124)가 재배달을 <b>사람</b> 단위로는 안전하게
 * 만들었지만, 한 사람을 다시 보내는 것은 그 사람의 이미 받은 기기까지 다시 울리는 일이다 —
 * 기기 단위 물결은 send() 안에서 끝나야 한다.
 *
 * <p>실제 푸시 서비스로 보낼 수 없으므로 로컬 HTTP 서버를 세우고 <b>기기별로 응답을 정해 준다</b>.
 * 암호화·서명은 라이브러리 몫이라 여기서 확인하지 않는다 — 다만 라이브러리가 진짜 동작해야 요청이
 * 나가므로 VAPID 키쌍과 구독 키를 <b>진짜로</b> 만든다.
 */
class WebPushRetryTest {

    private HttpServer server;
    private String baseUrl;

    /** 기기 이름 → 앞에서부터 돌려줄 상태 코드. 다 쓰면 마지막 것을 계속 쓴다. */
    private final Map<String, Queue<Integer>> scriptedStatuses = new ConcurrentHashMap<>();
    /** 기기 이름 → 응답 지연. 배치 마감(batch-timeout)에 걸려 <b>미완</b>이 되는 기기를 만들 때 쓴다. */
    private final Map<String, Long> scriptedDelays = new ConcurrentHashMap<>();
    /** 기기 이름 → 실제로 받은 요청 수. <b>여기서 중복 발송이 드러난다.</b> */
    private final Map<String, AtomicInteger> received = new ConcurrentHashMap<>();
    private volatile String retryAfterHeader;
    /** 마지막 요청이 들고 온 헤더. 옮겨 담는 과정에서 빠진 것이 없는지 여기서 본다. */
    private final Map<String, String> lastHeaders = new ConcurrentHashMap<>();
    private final AtomicInteger lastBodyLength = new AtomicInteger(-1);
    private volatile int lastStatus = 500;
    /** 응답을 늦추는 시간. 병렬인지 순차인지는 느린 응답에서만 드러난다. */
    private volatile long serverDelayMs = 0;
    private final AtomicInteger concurrentNow = new AtomicInteger();
    private final AtomicInteger concurrentPeak = new AtomicInteger();

    private PushSubscriptionRepository repository;
    private WebPushProperties properties;

    @BeforeEach
    void setUp() throws Exception {
        Security.addProvider(new BouncyCastleProvider());
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/push", exchange -> {
            String device = exchange.getRequestURI().getPath().substring("/push/".length());
            received.computeIfAbsent(device, k -> new AtomicInteger()).incrementAndGet();
            exchange.getRequestHeaders().forEach((name, values) -> lastHeaders.put(name, values.get(0)));
            lastBodyLength.set(exchange.getRequestBody().readAllBytes().length);
            int now = concurrentNow.incrementAndGet();
            concurrentPeak.accumulateAndGet(now, Math::max);
            long delay = scriptedDelays.getOrDefault(device, serverDelayMs);
            if (delay > 0) {
                try {
                    Thread.sleep(delay);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }
            concurrentNow.decrementAndGet();
            Integer status = scriptedStatuses.getOrDefault(device, new ConcurrentLinkedQueue<>()).poll();
            int answer = status == null ? lastStatus : status;
            if (answer == 429 && retryAfterHeader != null) {
                exchange.getResponseHeaders().add("Retry-After", retryAfterHeader);
            }
            exchange.sendResponseHeaders(answer, -1);
            exchange.close();
        });
        server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort() + "/push/";

        repository = mock(PushSubscriptionRepository.class);
        properties = vapidProperties();
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    /**
     * <b>이 테스트가 이 기능의 전부다.</b> A는 처음에 성공하고 B는 한 번 실패한 뒤 성공한다.
     * 재시도를 조각 단위로 하면 A가 두 번 받는다.
     */
    @Test
    void a_delivered_device_is_never_sent_twice() {
        PushSubscription a = subscription("a");
        PushSubscription b = subscription("b");
        script("a", 201);
        script("b", 500, 201);
        given(a, b);

        sender(3, 5_000).send(recipients(a, b), "제목", "본문", null);

        assertThat(count("a"))
                .as("이미 받은 기기를 다시 두드리면 그 기기가 두 번 운다")
                .isEqualTo(1);
        assertThat(count("b"))
                .as("실패한 기기만 다시 보낸다")
                .isEqualTo(2);
    }

    /** 계속 실패해도 무한히 하지 않는다. 상한이 없으면 조각 하나가 소비자를 붙잡는다. */
    @Test
    void it_gives_up_after_the_configured_attempts() {
        PushSubscription a = subscription("a");
        script("a", 500, 500, 500, 500, 500);
        given(a);

        sender(3, 5_000).send(recipients(a), "제목", "본문", null);

        assertThat(count("a")).isEqualTo(3);
        verify(repository, never()).deleteAllByIds(any());
    }

    /** 429는 "지금 말고 이따가"다. 언제가 이따인지는 상대가 정한다. */
    @Test
    void it_waits_as_long_as_the_push_service_asked() {
        PushSubscription a = subscription("a");
        script("a", 429, 201);
        retryAfterHeader = "1";
        given(a);

        long startedAt = System.nanoTime();
        sender(3, 10_000).send(recipients(a), "제목", "본문", null);
        long elapsedMs = (System.nanoTime() - startedAt) / 1_000_000;

        assertThat(count("a")).isEqualTo(2);
        assertThat(elapsedMs)
                .as("Retry-After를 무시하고 바로 다시 치면 또 429를 받는다")
                .isGreaterThanOrEqualTo(1_000);
    }

    /**
     * 상대가 부른 시간이 남은 예산보다 길면 <b>기다리지 않고 끝낸다</b>. 기다려 봐야 제한 시간에
     * 걸릴 뿐이고, 그동안 큐에 선 다른 알림이 늦는다.
     */
    @Test
    void it_does_not_wait_longer_than_the_batch_deadline() {
        PushSubscription a = subscription("a");
        script("a", 429, 201);
        retryAfterHeader = "120";
        given(a);

        sender(3, 2_000).send(recipients(a), "제목", "본문", null);

        // 재시도를 하지 않았다는 것이 곧 "기다리지 않았다"이다. 배치 예산(2초)이 대기 자체를
        // 이미 묶고 있으므로, 벽시계를 또 재면 바쁜 박스에서만 깨지는 단언이 하나 늘 뿐이다.
        assertThat(count("a")).isEqualTo(1);
    }

    /** 410은 구독이 영영 끝났다는 뜻이다. 다시 보낼 것이 아니라 지울 것이다. */
    @Test
    void an_expired_subscription_is_deleted_instead_of_retried() {
        PushSubscription a = subscription("a");
        script("a", 410);
        given(a);

        sender(3, 5_000).send(recipients(a), "제목", "본문", null);

        assertThat(count("a")).isEqualTo(1);
        // 지우기는 한 문장짜리 벌크 삭제로 간다(ADR-0124) — 엔티티가 아니라 id 목록을 본다.
        @SuppressWarnings("unchecked")
        ArgumentCaptor<java.util.Collection<UUID>> deleted = ArgumentCaptor.forClass(java.util.Collection.class);
        verify(repository).deleteAllByIds(deleted.capture());
        assertThat(deleted.getValue()).containsExactly(a.getId());
    }

    /**
     * 400은 요청 자체가 틀렸다는 뜻이라 다시 해도 같다. 그렇다고 구독을 지우지도 않는다 —
     * 끝난 구독은 404·410으로만 말한다.
     */
    @Test
    void a_permanent_rejection_is_not_retried_and_not_deleted() {
        PushSubscription a = subscription("a");
        script("a", 400, 201);
        given(a);

        sender(3, 5_000).send(recipients(a), "제목", "본문", null);

        assertThat(count("a")).isEqualTo(1);
        verify(repository, never()).deleteAllByIds(any());
    }

    /**
     * <b>우리가 만든 요청이 하나도 안 빠지고 나가는가.</b>
     *
     * <p>이 층에서 하는 일은 {@code WebPushRequest}를 JDK {@code HttpRequest}로 옮겨 담는 것뿐인데,
     * 옮기다 헤더 하나를 흘리면 <b>푸시 서비스가 거절하거나 기기가 복호화에 실패한다</b>. 그런데
     * 로컬 서버는 복호화를 하지 않으므로 다른 테스트는 헤더가 빠져도 그냥 통과한다.
     */
    @Test
    void every_header_we_set_arrives_intact() throws Exception {
        PushSubscription a = subscription("a");
        script("a", 201);

        var prepared = com.liveclass.notification.push.WebPushTestAccess.create(
                properties, a, "본문".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        new com.liveclass.notification.push.WebPushHttpClient(
                Duration.ofSeconds(2), Duration.ofSeconds(5))
                .send(new com.liveclass.notification.push.WebPushRequest(
                        java.net.URI.create(a.getEndpoint()), prepared.headers(), prepared.body()))
                .get();

        for (var entry : prepared.headers().entrySet()) {
            if (JDK_MANAGED.contains(entry.getKey().toLowerCase())) {
                continue;
            }
            assertThat(headerReceived(entry.getKey()))
                    .as("%s 헤더가 옮겨 담는 과정에서 사라졌다", entry.getKey())
                    .isEqualTo(entry.getValue());
        }
        assertThat(headerReceived("Authorization"))
                .as("VAPID 서명이 없으면 푸시 서비스가 거절한다")
                .startsWith("vapid");
        assertThat(lastBodyLength.get())
                .as("암호문이 한 바이트라도 달라지면 복호화가 깨진다")
                .isEqualTo(prepared.body().length);
    }

    /** JDK 클라이언트가 직접 채우는 헤더. 우리가 옮기지 않는 것이 맞다. */
    private static final java.util.Set<String> JDK_MANAGED =
            java.util.Set.of("content-length", "host", "connection", "upgrade", "expect");

    private String headerReceived(String name) {
        return lastHeaders.entrySet().stream()
                .filter(entry -> entry.getKey().equalsIgnoreCase(name))
                .map(Map.Entry::getValue)
                .findFirst()
                .orElse(null);
    }

    /**
     * <b>기기들을 겹쳐서 친다.</b> Web Push에는 배치가 없어 기기 수만큼 HTTPS를 쳐야 하므로,
     * 순차로 돌면 기기 수 × 왕복이 그대로 조각의 소요 시간이 된다.
     *
     * <p>시간만 재면 "빨랐다"까지밖에 못 말하므로 <b>서버가 동시 접속 수를 직접 센다</b>.
     */
    @Test
    void it_sends_to_devices_concurrently_instead_of_one_at_a_time() {
        int devices = 60;
        serverDelayMs = 100;
        PushSubscription[] subscriptions = new PushSubscription[devices];
        for (int i = 0; i < devices; i++) {
            subscriptions[i] = subscription("d" + i);
            script("d" + i, 201);
        }
        given(subscriptions);

        sender(1, 30_000, devices).send(recipients(subscriptions), "제목", "본문", null);

        /*
         * 기기 수만큼 겹치지는 않는다 — 제출 루프가 기기마다 **암호화를 직렬로** 하기 때문이다
         * (preparePost는 ECDH + AES-GCM + JWT 서명이라 공짜가 아니다). 그래서 동시 접속의 천장은
         * "응답 지연 ÷ 암호화 시간"쯤에서 정해진다. 여기서 보려는 것은 그 천장이 아니라
         * **1이 아니라는 것**이다.
         */
        assertThat(concurrentPeak.get())
                .as("순차로 보내면 동시 접속이 1을 넘지 않는다")
                .isGreaterThan(10);
        for (int i = 0; i < devices; i++) {
            assertThat(count("d" + i)).isEqualTo(1);
        }
    }

    /**
     * <b>동시 상한은 진짜 상한이다.</b> 안 묶으면 조각 하나가 기기 수천 대일 때 요청이 한꺼번에 나가
     * 푸시 서비스가 429로 막고, 그동안 펜딩 객체가 메모리에 쌓인다.
     */
    @Test
    void it_never_exceeds_the_configured_in_flight_limit() {
        int devices = 60;
        int limit = 8;
        serverDelayMs = 50;
        PushSubscription[] subscriptions = new PushSubscription[devices];
        for (int i = 0; i < devices; i++) {
            subscriptions[i] = subscription("d" + i);
            script("d" + i, 201);
        }
        given(subscriptions);

        sender(1, 30_000, limit).send(recipients(subscriptions), "제목", "본문", null);

        assertThat(concurrentPeak.get())
                .as("상한을 넘으면 세마포어가 일을 하지 않는 것이다")
                .isLessThanOrEqualTo(limit);
        assertThat(concurrentPeak.get())
                .as("그렇다고 1이면 병렬이 아니다")
                .isGreaterThan(1);
    }

    // ---- 반환값: "시도를 마친 사람" (ADR-0124) ----

    /**
     * <b>반환값은 진행 표에 기록될 집합이다.</b> 여기 들어간 사람은 큐 재배달이 다시 집지 않으므로,
     * 성공뿐 아니라 <b>최종 실패도</b> 들어가야 한다 — 재시도 물결은 이 호출 안에서 끝났고, 실패한
     * 기기를 재배달로 또 치게 두면 그 사람의 이미 받은 기기까지 다시 운다.
     */
    @Test
    void the_settled_set_contains_successes_and_final_failures_alike() {
        PushSubscription ok = subscription("ok");
        PushSubscription broken = subscription("broken");
        script("ok", 201);
        script("broken", 500, 500, 500);
        given(ok, broken);

        java.util.Set<UUID> settled = sender(3, 5_000).send(recipients(ok, broken), "제목", "본문", null);

        assertThat(settled).containsExactlyInAnyOrder(ok.getUserId(), broken.getUserId());
    }

    /**
     * batch-timeout으로 <b>응답을 못 본</b> 기기의 주인은 빠진다. 그 사람은 기록되지 않아 큐
     * 재배달이 다시 집는다 — "미완"과 "실패"를 가르는 경계가 이것이다(실패는 결과를 봤다).
     */
    @Test
    void an_abandoned_device_keeps_its_owner_out_of_the_settled_set() {
        PushSubscription fast = subscription("fast");
        PushSubscription slow = subscription("slow");
        script("fast", 201);
        script("slow", 201);
        scriptedDelays.put("slow", 8_000L);
        given(fast, slow);

        java.util.Set<UUID> settled = sender(1, 2_000).send(recipients(fast, slow), "제목", "본문", null);

        assertThat(settled)
                .as("응답을 본 기기의 주인만 끝났다")
                .containsExactly(fast.getUserId());
    }

    /** 구독이 하나도 없는 사람은 보낼 곳이 없으니 그 자리에서 끝났다 — 재배달이 다시 집으면 헛돈다. */
    @Test
    void a_recipient_without_a_device_is_settled_immediately() {
        PushSubscription a = subscription("a");
        script("a", 201);
        given(a);
        UUID deviceless = UUID.randomUUID();
        java.util.List<UUID> everyone = new java.util.ArrayList<>(recipients(a));
        everyone.add(deviceless);

        java.util.Set<UUID> settled = sender(3, 5_000).send(everyone, "제목", "본문", null);

        assertThat(settled).containsExactlyInAnyOrder(a.getUserId(), deviceless);
    }

    /**
     * 키가 없어 꺼져 있으면 <b>전원 끝난 것</b>으로 답한다. 빈 집합을 주면 진행 표가 영영 차지
     * 않아, 켜 있지도 않은 푸시 때문에 재배달이 같은 명단을 계속 다시 집는다.
     */
    @Test
    void a_disabled_sender_settles_everyone_because_there_is_nothing_to_send() {
        WebPushSender disabled = new WebPushSender(repository, new WebPushProperties("", "", null),
                new NoOpTransactionManager(), 10, 2_000, 5_000, 5_000, 3, 10, Integer.MAX_VALUE, 0);
        UUID recipient = UUID.randomUUID();

        java.util.Set<UUID> settled = disabled.send(List.of(recipient), "제목", "본문", null);

        assertThat(settled).containsExactly(recipient);
    }

    // ---- 도구 ----

    private WebPushSender sender(int maxAttempts, long batchTimeoutMs) {
        return sender(maxAttempts, batchTimeoutMs, 10);
    }

    private WebPushSender sender(int maxAttempts, long batchTimeoutMs, int maxInFlight) {
        return sender(maxAttempts, batchTimeoutMs, maxInFlight, 0);
    }

    private WebPushSender sender(int maxAttempts, long batchTimeoutMs, int maxInFlight, int cryptoThreads) {
        return new WebPushSender(repository, properties, new NoOpTransactionManager(),
                maxInFlight, 2_000, 5_000, batchTimeoutMs, maxAttempts, 10,
                // 로컬 서버는 h2가 아니라 스트림 상한이 의미 없다 — 연결 하나로 붙게 둔다.
                Integer.MAX_VALUE, cryptoThreads);
    }

    private void given(PushSubscription... subscriptions) {
        when(repository.findByUserIdIn(any())).thenReturn(List.of(subscriptions));
    }

    private void script(String device, Integer... statuses) {
        scriptedStatuses.put(device, new ConcurrentLinkedQueue<>(List.of(statuses)));
    }

    private int count(String device) {
        AtomicInteger counter = received.get(device);
        return counter == null ? 0 : counter.get();
    }

    private static List<UUID> recipients(PushSubscription... subscriptions) {
        return java.util.Arrays.stream(subscriptions).map(PushSubscription::getUserId).toList();
    }

    private PushSubscription subscription(String device) {
        KeyPair keyPair = generateKeyPair();
        PushSubscription subscription = new PushSubscription();
        subscription.setId(UUID.randomUUID());
        subscription.setUserId(UUID.randomUUID());
        subscription.setEndpoint(baseUrl + device);
        subscription.setP256dh(base64Url(Utils.encode((ECPublicKey) keyPair.getPublic())));
        byte[] auth = new byte[16];
        new SecureRandom().nextBytes(auth);
        subscription.setAuth(base64Url(auth));
        return subscription;
    }

    /** VAPID 키쌍은 <b>진짜로</b> 만든다. 가짜면 라이브러리가 요청을 만들다 죽어 재시도까지 못 간다. */
    private static WebPushProperties vapidProperties() {
        KeyPair keyPair = generateKeyPair();
        return new WebPushProperties(
                base64Url(Utils.encode((ECPublicKey) keyPair.getPublic())),
                base64Url(Utils.encode((ECPrivateKey) keyPair.getPrivate())),
                "mailto:test@example.com");
    }

    private static KeyPair generateKeyPair() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("ECDH", BouncyCastleProvider.PROVIDER_NAME);
            generator.initialize(new ECGenParameterSpec("prime256v1"), new SecureRandom());
            return generator.generateKeyPair();
        } catch (Exception e) {
            throw new IllegalStateException("테스트용 키쌍을 만들지 못했습니다.", e);
        }
    }

    private static String base64Url(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /**
     * 트랜잭션은 여기서 확인할 대상이 아니다 — 이 테스트가 보는 것은 <b>어떤 기기에 몇 번 보내는가</b>다.
     * DB를 띄우지 않으려고 아무 일도 하지 않는 매니저를 쓴다.
     */
    private static final class NoOpTransactionManager implements PlatformTransactionManager {
        @Override
        public TransactionStatus getTransaction(TransactionDefinition definition) {
            return new SimpleTransactionStatus();
        }

        @Override
        public void commit(TransactionStatus status) {
        }

        @Override
        public void rollback(TransactionStatus status) {
        }
    }
}
