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
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.security.Security;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.List;
import java.util.Map;
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
 * <p>큐가 이 일을 대신할 수 없다. 메시지를 재배달하면 알림 행이 이미 커밋돼 있어 중복 제거가
 * 수신자 명단을 <b>비워서</b> 돌려주고, 그러면 못 받은 사람도 영영 못 받는다.
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
    /** 기기 이름 → 실제로 받은 요청 수. <b>여기서 중복 발송이 드러난다.</b> */
    private final Map<String, AtomicInteger> received = new ConcurrentHashMap<>();
    private volatile String retryAfterHeader;
    private volatile int lastStatus = 500;

    private PushSubscriptionRepository repository;
    private WebPushProperties properties;

    @BeforeEach
    void setUp() throws Exception {
        Security.addProvider(new BouncyCastleProvider());
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/push", exchange -> {
            String device = exchange.getRequestURI().getPath().substring("/push/".length());
            received.computeIfAbsent(device, k -> new AtomicInteger()).incrementAndGet();
            exchange.getRequestBody().readAllBytes();
            Integer status = scriptedStatuses.getOrDefault(device, new ConcurrentLinkedQueue<>()).poll();
            int answer = status == null ? lastStatus : status;
            if (answer == 429 && retryAfterHeader != null) {
                exchange.getResponseHeaders().add("Retry-After", retryAfterHeader);
            }
            exchange.sendResponseHeaders(answer, -1);
            exchange.close();
        });
        server.setExecutor(java.util.concurrent.Executors.newFixedThreadPool(8));
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
        verify(repository, never()).deleteAll(any());
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

        long startedAt = System.nanoTime();
        sender(3, 2_000).send(recipients(a), "제목", "본문", null);
        long elapsedMs = (System.nanoTime() - startedAt) / 1_000_000;

        assertThat(count("a")).isEqualTo(1);
        assertThat(elapsedMs).isLessThan(2_000);
    }

    /** 410은 구독이 영영 끝났다는 뜻이다. 다시 보낼 것이 아니라 지울 것이다. */
    @Test
    void an_expired_subscription_is_deleted_instead_of_retried() {
        PushSubscription a = subscription("a");
        script("a", 410);
        given(a);

        sender(3, 5_000).send(recipients(a), "제목", "본문", null);

        assertThat(count("a")).isEqualTo(1);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Iterable<PushSubscription>> deleted = ArgumentCaptor.forClass(Iterable.class);
        verify(repository).deleteAll(deleted.capture());
        assertThat(deleted.getValue()).containsExactly(a);
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
        verify(repository, never()).deleteAll(any());
    }

    // ---- 도구 ----

    private WebPushSender sender(int maxAttempts, long batchTimeoutMs) {
        return new WebPushSender(repository, properties, new NoOpTransactionManager(),
                10, 2_000, 5_000, batchTimeoutMs, maxAttempts, 10);
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
