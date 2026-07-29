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

    private static final Path FIXTURES = Path.of(
            "../ai/realtime-agent/contracts/fixtures").toAbsolutePath().normalize();

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
