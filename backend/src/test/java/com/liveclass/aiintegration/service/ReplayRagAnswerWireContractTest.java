package com.liveclass.aiintegration.service;

import com.liveclass.aiintegration.api.ReplayRagAnswerCommand;
import com.liveclass.aiintegration.config.RagApiProperties;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/** Spring→ai-api Replay v2의 필드 집합·ID 매핑·원시 body HMAC 계약. */
class ReplayRagAnswerWireContractTest {

    private static final String SECRET = "recorded-replay-contract-secret";
    private static final AtomicReference<CapturedRequest> captured = new AtomicReference<>();
    private static HttpServer server;

    private record CapturedRequest(String path, String signature, byte[] rawBody) {
    }

    @BeforeAll
    static void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            byte[] rawBody = exchange.getRequestBody().readAllBytes();
            captured.set(new CapturedRequest(
                    exchange.getRequestURI().getPath(),
                    exchange.getRequestHeaders().getFirst("X-Internal-Signature"),
                    rawBody));
            respond(exchange);
        });
        server.start();
    }

    @AfterAll
    static void stopServer() {
        server.stop(0);
    }

    @Test
    void sends_recorded_video_id_as_session_id_with_exact_replay_v2_body() throws Exception {
        UUID lessonId = UUID.randomUUID();
        UUID curriculumId = UUID.randomUUID();
        UUID recordedVideoId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        RagApiProperties properties = new RagApiProperties(
                "http://127.0.0.1:" + server.getAddress().getPort(),
                SECRET,
                Duration.ofSeconds(1),
                Duration.ofSeconds(5));
        RagInternalSigner signer = new RagInternalSigner(properties);
        ReplayRagAnswerHttpClient client = new ReplayRagAnswerHttpClient(properties, signer);
        ReplayRagAnswerCommand command = new ReplayRagAnswerCommand(
                "request-recorded-1",
                lessonId,
                curriculumId,
                recordedVideoId,
                "이 부분을 설명해줘",
                735_000L,
                List.of(new ReplayRagAnswerCommand.Caption(
                        jobId.toString(), 0, 720_000L, 728_000L, "consumer group을 설명합니다.")));

        try (var handle = client.open(command)) {
            handle.forEachEvent(event -> assertThat(event.name()).isEqualTo("answer.done"));
        }

        CapturedRequest request = captured.get();
        assertThat(request.path()).isEqualTo("/internal/v2/rag/answers:stream");
        assertThat(request.signature()).isEqualTo(signer.sign(request.rawBody()));
        JsonNode body = JsonMapper.builder().build().readTree(request.rawBody());
        assertThat(body.properties()).extracting(Map.Entry::getKey).containsExactlyInAnyOrder(
                "requestId", "lessonId", "curriculumId", "sessionId", "question", "context", "issuedAtMs");
        assertThat(body.get("lessonId").asString()).isEqualTo(lessonId.toString());
        assertThat(body.get("curriculumId").asString()).isEqualTo(curriculumId.toString());
        assertThat(body.get("sessionId").asString()).isEqualTo(recordedVideoId.toString());
        assertThat(body.get("question").asString()).isEqualTo("이 부분을 설명해줘");
        JsonNode context = body.get("context");
        assertThat(context.properties()).extracting(Map.Entry::getKey)
                .containsExactlyInAnyOrder("mode", "questionSessionMs", "captions");
        assertThat(context.get("mode").asString()).isEqualTo("REPLAY");
        assertThat(context.get("questionSessionMs").asLong()).isEqualTo(735_000L);
        JsonNode caption = context.get("captions").get(0);
        assertThat(caption.get("sttSessionId").asString()).isEqualTo(jobId.toString());
        assertThat(caption.get("segmentIndex").asInt()).isZero();
        assertThat(caption.get("startSessionMs").asLong()).isEqualTo(720_000L);
        assertThat(caption.get("endSessionMs").asLong()).isEqualTo(728_000L);
    }

    private static void respond(HttpExchange exchange) throws IOException {
        byte[] response = ("event: answer.done\n"
                + "data: {\"requestId\":\"request-recorded-1\",\"sources\":[]}\n\n")
                .getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "text/event-stream");
        exchange.sendResponseHeaders(200, response.length);
        exchange.getResponseBody().write(response);
        exchange.close();
    }
}
