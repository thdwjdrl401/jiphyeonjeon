package com.liveclass.live.service;

import com.liveclass.live.config.AnnotationAiProperties;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 강조 설명 요청이 <b>이미지 크기와 무관</b>한지 못박는다(ADR-0058·ADR-0079).
 *
 * <p>GMS 게이트웨이에는 본문 한도(~100KB)가 있고, 넘으면 크기와 상관없어 보이는
 * {@code "Model not found in request"}를 돌려준다 — 실제로 그 오류를 쫓느라 시간을 썼다(ADR-0058).
 * 그래서 이미지를 본문에 싣지 않고 <b>모델이 가져갈 URL</b>만 준다.
 *
 * <p>ADR-0079로 크롭을 걷어내고 화면 <b>전체</b>를 보내게 되면서 이미지가 커졌다(실측 57~131 KiB).
 * 그 변화가 이 경로에 닿지 않는다는 것이 여기서 고정하려는 사실이다 — 닿는다면 강조를 크게 그릴수록
 * 설명이 실패하던 옛 버그가 그대로 되살아난다.
 */
class AnnotationVisionRequestSizeTest {

    /** 게이트웨이 본문 한도(ADR-0058). 이 아래로 <b>한참</b> 남아야 안전하다. */
    private static final int GATEWAY_BODY_LIMIT_BYTES = 100 * 1024;

    private HttpServer server;
    private final AtomicReference<byte[]> captured = new AtomicReference<>();

    @BeforeEach
    void setUp() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            captured.set(exchange.getRequestBody().readAllBytes());
            byte[] response = """
                    {"choices":[{"message":{"tool_calls":[{"function":{
                      "arguments":"{\\"text\\":\\"표시한 코드 블록\\",\\"readable\\":true}"}}]}}]}"""
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    private AnnotationHighlightDescriber describer() {
        AnnotationAiProperties properties = new AnnotationAiProperties(
                "http://127.0.0.1:" + server.getAddress().getPort() + "/v1",
                "test-key",
                "gpt-4.1",
                Duration.ofSeconds(5),
                Duration.ofSeconds(10),
                4 * 1024 * 1024,
                "http://127.0.0.1");
        return new AnnotationHighlightDescriber(
                new GmsAnnotationVisionModel(properties, new AnnotationInterpretImageStore()));
    }

    @Test
    void 본문에_이미지_바이트를_싣지_않는다() {
        assertThat(describer().describe("https://assets.test/annotation_snapshot/abc?sig=x"))
                .isEqualTo("표시한 코드 블록");

        String body = new String(captured.get(), StandardCharsets.UTF_8);
        assertThat(body).contains("https://assets.test/annotation_snapshot/abc?sig=x");
        // 바이트를 실었다면 이 둘 중 하나가 남는다. 남으면 곧 게이트웨이 한도에 닿는다.
        assertThat(body).doesNotContain("data:image");
        assertThat(body).doesNotContain("base64");
    }

    /**
     * 화면 전체를 보내도(ADR-0079) 본문은 프롬프트 + 툴 스키마 + URL이 전부다. 실측 57~131 KiB짜리
     * 이미지가 이 숫자를 흔들지 않는다는 것이 요점이다.
     */
    @Test
    void 본문은_게이트웨이_한도에_한참_못_미친다() {
        describer().describe("https://assets.test/annotation_snapshot/abc?sig=x");

        assertThat(captured.get().length).isLessThan(GATEWAY_BODY_LIMIT_BYTES / 8);
    }

    /**
     * presigned 서명이 길어져도 늘어나는 것은 URL 길이뿐이다. 이미지 크기는 어느 쪽에도 들어오지 않는다.
     */
    @Test
    void 본문_크기는_URL_길이로만_변한다() {
        describer().describe("https://assets.test/a");
        int shortUrlBody = captured.get().length;

        String longUrl = "https://assets.test/a?sig=" + "s".repeat(2000);
        describer().describe(longUrl);
        int longUrlBody = captured.get().length;

        assertThat(longUrlBody - shortUrlBody).isEqualTo(longUrl.length() - "https://assets.test/a".length());
    }
}
