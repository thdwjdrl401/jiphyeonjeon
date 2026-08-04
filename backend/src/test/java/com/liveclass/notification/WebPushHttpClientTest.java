package com.liveclass.notification;

import com.liveclass.notification.push.WebPushHttpClient;
import com.sun.net.httpserver.HttpServer;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.ByteArrayEntity;
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
    private final AtomicInteger requests = new AtomicInteger();
    private final Set<String> remotePorts = ConcurrentHashMap.newKeySet();
    private volatile String lastAuthorization;
    private volatile String lastBody;
    private volatile int responseStatus = 201;
    private volatile String retryAfter;

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/push", exchange -> {
            requests.incrementAndGet();
            // 연결 재사용 여부는 클라이언트 쪽 포트로 본다 — 재사용하면 같은 포트가 다시 온다.
            remotePorts.add(String.valueOf(exchange.getRemoteAddress().getPort()));
            lastAuthorization = exchange.getRequestHeaders().getFirst("Authorization");
            lastBody = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            if (retryAfter != null) {
                exchange.getResponseHeaders().add("Retry-After", retryAfter);
            }
            exchange.sendResponseHeaders(responseStatus, -1);
            exchange.close();
        });
        server.setExecutor(java.util.concurrent.Executors.newFixedThreadPool(8));
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private String url() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/push";
    }

    private HttpPost prepared(String body) {
        HttpPost post = new HttpPost(url());
        // 라이브러리가 붙이는 것과 같은 모양 — VAPID 서명과 암호화 헤더.
        post.setHeader("Authorization", "vapid t=fake-jwt, k=fake-key");
        post.setHeader("Content-Encoding", "aes128gcm");
        post.setHeader("TTL", "2419200");
        post.setEntity(new ByteArrayEntity(body.getBytes(StandardCharsets.UTF_8)));
        return post;
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
