package com.liveclass.notification;

import com.liveclass.notification.push.WebPushHttpClient;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 공유 HTTP 클라이언트가 <b>라이브러리가 만든 요청을 그대로</b> 보내고 <b>연결을 재사용</b>하는지.
 *
 * <p>라이브러리의 발송 경로를 쓰지 않는 이유가 요청마다 클라이언트를 새로 만들기 때문이라
 * (연결 재사용 없음), 대체한 쪽은 그 반대임을 보여야 한다.
 *
 * <p>실제 푸시 서비스로 보낼 수는 없으므로 로컬 HTTP 서버를 세운다 — 여기서 확인하는 것은
 * <b>우리가 통제하는 부분</b>(헤더 전달·본문·연결 재사용·동시성)이고, 암호화·서명은 라이브러리 몫이다.
 */
class WebPushHttpClientTest {

    private HttpServer server;
    private String endpoint;
    private final AtomicInteger requests = new AtomicInteger();
    private final Set<String> remotePorts = ConcurrentHashMap.newKeySet();
    private volatile String lastAuthorization;
    private volatile String lastBody;
    private volatile int responseStatus = 201;
    private volatile String retryAfter;
    private volatile long responseDelayMs = 0;
    /** 클라이언트 포트별로 동시에 물고 있던 최대 요청 수 — 연결당 쏠림이 여기서 보인다. */
    private final java.util.Map<String, AtomicInteger> peakPerPort = new ConcurrentHashMap<>();
    private final java.util.Map<String, AtomicInteger> nowPerPort = new ConcurrentHashMap<>();

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/push", exchange -> {
            requests.incrementAndGet();
            // 연결 재사용 여부는 클라이언트 쪽 포트로 본다 — 재사용하면 같은 포트가 다시 온다.
            String port = String.valueOf(exchange.getRemoteAddress().getPort());
            remotePorts.add(port);
            int now = nowPerPort.computeIfAbsent(port, k -> new AtomicInteger()).incrementAndGet();
            peakPerPort.computeIfAbsent(port, k -> new AtomicInteger())
                    .accumulateAndGet(now, Math::max);
            if (responseDelayMs > 0) {
                try {
                    Thread.sleep(responseDelayMs);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }
            nowPerPort.get(port).decrementAndGet();
            lastAuthorization = exchange.getRequestHeaders().getFirst("Authorization");
            lastBody = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            if (retryAfter != null) {
                exchange.getResponseHeaders().add("Retry-After", retryAfter);
            }
            exchange.sendResponseHeaders(responseStatus, -1);
            exchange.close();
        });
        server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
        server.start();
        endpoint = "http://127.0.0.1:" + server.getAddress().getPort() + "/push";
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private String url() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/push";
    }

    /** 암호화가 끝난 상태의 요청. 이 테스트가 보는 것은 <b>전송</b>뿐이다. */
    private com.liveclass.notification.push.WebPushRequest prepared(String body) {
        return new com.liveclass.notification.push.WebPushRequest(
                java.net.URI.create(endpoint),
                new java.util.LinkedHashMap<>(java.util.Map.of(
                        "Authorization", "vapid t=fake-jwt, k=fake-key",
                        "Content-Encoding", "aes128gcm",
                        "TTL", "2419200")),
                body.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void it_sends_the_prepared_request_untouched() throws Exception {
        var client = new WebPushHttpClient(Duration.ofSeconds(2), Duration.ofSeconds(5));

        var response = client.send(prepared("암호화된-본문")).get();

        assertThat(response.status()).isEqualTo(201);
        assertThat(lastAuthorization)
                .as("VAPID 서명을 우리가 만들거나 고치지 않는다")
                .isEqualTo("vapid t=fake-jwt, k=fake-key");
        assertThat(lastBody).isEqualTo("암호화된-본문");
    }

    /**
     * <b>연결을 재사용한다.</b> 라이브러리가 요청마다 클라이언트를 새로 만들던 것을 대체한 이유가
     * 이것이다 — 재사용이 없으면 요청마다 TCP + TLS 핸드셰이크를 다시 한다.
     */
    @Test
    void it_reuses_connections_across_sends() throws Exception {
        var client = new WebPushHttpClient(Duration.ofSeconds(2), Duration.ofSeconds(5));

        for (int i = 0; i < 5; i++) {
            client.send(prepared("본문" + i)).get();
        }

        assertThat(requests.get()).isEqualTo(5);
        assertThat(remotePorts)
                .as("연결을 재사용하면 클라이언트 포트가 하나다")
                .hasSize(1);
    }

    /** 상태 코드를 그대로 돌려준다 — 404·410 판정이 여기에 걸려 있다. */
    @Test
    void it_reports_the_status_code_as_is() throws Exception {
        responseStatus = 410;
        var client = new WebPushHttpClient(Duration.ofSeconds(2), Duration.ofSeconds(5));

        assertThat(client.send(prepared("x")).get().status()).isEqualTo(410);
    }

    /**
     * {@code Retry-After}를 읽는다. RFC 9110이 <b>초와 HTTP 날짜</b> 두 형식을 허용하고 푸시
     * 서비스마다 다른 쪽을 쓰므로, 하나만 읽으면 그 서비스에서 재시도가 조용히 죽는다.
     */
    @Test
    void it_reads_retry_after_in_both_shapes() throws Exception {
        var client = new WebPushHttpClient(Duration.ofSeconds(2), Duration.ofSeconds(5));
        responseStatus = 429;

        retryAfter = "30";
        assertThat(client.send(prepared("x")).get().retryAfter()).isEqualTo(Duration.ofSeconds(30));

        retryAfter = java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME.format(
                java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).plusSeconds(30));
        assertThat(client.send(prepared("x")).get().retryAfter())
                .as("날짜 형식도 남은 시간으로 환산한다")
                .isBetween(Duration.ofSeconds(20), Duration.ofSeconds(31));

        // 헤더가 없으면 null이다 — 부르는 쪽이 자기 백오프를 쓴다.
        responseStatus = 201;
        retryAfter = null;
        assertThat(client.send(prepared("x")).get().retryAfter()).isNull();
    }

    /**
     * <b>한가할 때는 연결을 늘리지 않는다.</b> 앞 요청이 끝난 뒤 보내면 물고 있는 것이 없으므로
     * 늘 같은 연결이 뽑힌다 — 연결을 더 여는 것은 <b>동시에 보낼 때만</b> 의미가 있다.
     */
    @Test
    void it_reuses_one_connection_when_requests_do_not_overlap() throws Exception {
        var pooled = new WebPushHttpClient(Duration.ofSeconds(2), Duration.ofSeconds(5), 4);

        for (int i = 0; i < 8; i++) {
            pooled.send(prepared("본문" + i)).get();
        }

        assertThat(pooled.inFlightPerConnection())
                .as("끝난 뒤에는 어느 연결도 물고 있는 것이 없어야 한다")
                .allSatisfy(count -> assertThat(count).isZero());
        assertThat(remotePorts)
                .as("겹치지 않으면 연결 하나로 충분하다")
                .hasSize(1);
    }

    /**
     * 연결 수는 짐작이 아니라 계산이고, <b>광고값을 다 쓰지 않는다</b>.
     *
     * <p>JDK는 연결의 스트림 상한을 넘으면 줄을 세우지 않고 {@code IOException("too many
     * concurrent streams")}를 던진다. 그래서 100%로 계산하면 순간적인 쏠림이나 서버의 상한 하향에
     * 바로 터지고, 그 실패가 재시도를 불러 부하를 더 만든다 — 10만 건 부하에서 실제로 그랬다.
     */
    @Test
    void it_leaves_headroom_below_the_advertised_stream_limit() {
        assertThat(WebPushHttpClient.connectionsFor(200, 100))
                .as("광고값 100을 다 쓰면 2개지만, 여유를 남기면 3개다")
                .isEqualTo(3);
        assertThat(WebPushHttpClient.connectionsFor(80, 100)).isEqualTo(1);
        assertThat(WebPushHttpClient.connectionsFor(81, 100))
                .as("한 연결이 감당할 몫을 넘으면 다음 연결이 필요하다")
                .isEqualTo(2);
        assertThat(WebPushHttpClient.connectionsFor(1, 100)).isEqualTo(1);
    }

    /**
     * <b>가장 한가한 연결을 고른다.</b> 순번으로 돌리면 배정만 고르고 물고 있는 수는 안 고르다 —
     * 완료 시점이 제각각이라 한쪽에 쌓이고, 그 연결이 스트림 상한을 넘으면 통째로 실패한다.
     *
     * <p>느린 응답으로 요청을 붙잡아 두고 보면, 연결마다 물고 있는 수가 고르게 퍼져야 한다.
     */
    @Test
    void it_spreads_in_flight_requests_evenly_across_connections() throws Exception {
        int connections = 4;
        int requests = 40;
        responseDelayMs = 300;
        var pooled = new WebPushHttpClient(Duration.ofSeconds(2), Duration.ofSeconds(10), connections);

        List<CompletableFuture<WebPushHttpClient.Response>> futures =
                java.util.stream.IntStream.range(0, requests)
                        .mapToObj(i -> pooled.send(prepared("본문" + i)))
                        .toList();

        // 전부 서버에 붙잡혀 있는 동안 들여다본다 — 끝난 뒤에는 전부 0이라 볼 것이 없다.
        Thread.sleep(150);
        List<Integer> inFlight = pooled.inFlightPerConnection();
        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).get();

        assertThat(inFlight)
                .as("연결마다 몫이 고르지 않으면 몰린 쪽이 자기 스트림 상한을 넘어 통째로 실패한다")
                .allSatisfy(count -> assertThat(count).isBetween(
                        requests / connections - 2, requests / connections + 2));
    }

    @Test
    void it_sends_many_requests_concurrently() throws Exception {
        var client = new WebPushHttpClient(Duration.ofSeconds(2), Duration.ofSeconds(5));

        List<CompletableFuture<WebPushHttpClient.Response>> futures = java.util.stream.IntStream.range(0, 50)
                .mapToObj(i -> client.send(prepared("본문" + i)))
                .toList();
        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).get();

        assertThat(requests.get()).isEqualTo(50);
        assertThat(futures).allSatisfy(f -> assertThat(f.get().status()).isEqualTo(201));
    }
}
