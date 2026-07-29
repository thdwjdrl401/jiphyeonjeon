package com.liveclass.live;

import com.liveclass.live.api.RealtimeAgentHealth.Liveness;
import com.liveclass.live.api.RealtimeAgentHealth.Readiness;
import com.liveclass.live.config.RealtimeAgentHealthProperties;
import com.liveclass.live.service.HttpRealtimeAgentHealth;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class RealtimeAgentHealthContractTest {

    private static final Path REPOSITORY_ROOT = Path.of("..").toAbsolutePath().normalize();
    private static final Path FIXTURES = REPOSITORY_ROOT.resolve(
            "ai/realtime-agent/contracts/fixtures");

    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    private final AtomicReference<String> readinessBody = new AtomicReference<>();
    private final AtomicInteger readinessStatus = new AtomicInteger();
    private HttpServer server;
    private HttpRealtimeAgentHealth client;

    @BeforeEach
    void setUp() throws IOException {
        String livenessBody = fixture("realtime-agent-live.valid.json");
        readinessBody.set(fixture("realtime-agent-not-ready.valid.json"));
        readinessStatus.set(503);
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/health/live", exchange -> respond(exchange, 200, livenessBody));
        server.createContext("/health/ready", exchange ->
                respond(exchange, readinessStatus.get(), readinessBody.get()));
        server.start();

        RealtimeAgentHealthProperties properties = new RealtimeAgentHealthProperties(
                URI.create("http://127.0.0.1:" + server.getAddress().getPort()),
                Duration.ofSeconds(2));
        client = new HttpRealtimeAgentHealth(
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build(),
                jsonMapper,
                properties);
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    @Test
    void java_client_consumes_shared_liveness_and_not_ready_fixtures() {
        Liveness liveness = client.liveness();
        Readiness readiness = client.readiness();

        assertThat(liveness).isEqualTo(new Liveness("1", "alive", "realtime-agent"));
        assertThat(readiness.status()).isEqualTo("notReady");
        assertThat(readiness.ready()).isFalse();
        assertThat(readiness.readyProcessCount()).isZero();
        assertThat(readiness.expectedProcessCount()).isEqualTo(1);
    }

    @Test
    void java_client_consumes_shared_ready_fixture_only_with_http_200() throws IOException {
        readinessBody.set(fixture("realtime-agent-ready.valid.json"));
        readinessStatus.set(200);

        Readiness readiness = client.readiness();

        assertThat(readiness.status()).isEqualTo("ready");
        assertThat(readiness.sttProvider()).isEqualTo("nemotron");
        assertThat(readiness.liveKitConnected()).isTrue();
        assertThat(readiness.modelsReady()).isTrue();
        assertThat(readiness.ready()).isTrue();
    }

    @Test
    void production_backend_proxy_reaches_loopback_tunnel_without_public_health_port()
            throws IOException {
        String nginx = Files.readString(
                REPOSITORY_ROOT.resolve("infra/livekit/nginx-livekit-prod.conf"),
                StandardCharsets.UTF_8);
        String compose = Files.readString(
                REPOSITORY_ROOT.resolve("docker-compose.prod.yml"), StandardCharsets.UTF_8);

        assertThat(nginx).contains(
                "location /internal/realtime-agent/",
                "allow 172.16.0.0/12;",
                "deny all;",
                "proxy_pass       http://127.0.0.1:18081/;");
        assertThat(compose).contains(
                "LIVE_STT_HEALTH_BASE_URL: "
                        + "https://jiphyeonjeon.thdwjdrl.com:7443/internal/realtime-agent/");
    }

    private static String fixture(String name) throws IOException {
        return Files.readString(FIXTURES.resolve(name), StandardCharsets.UTF_8);
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] encoded = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, encoded.length);
        try (exchange; var response = exchange.getResponseBody()) {
            response.write(encoded);
        }
    }
}
