package com.liveclass.aiintegration.service;

import com.liveclass.aiintegration.api.RagAnswerCommand;
import com.liveclass.aiintegration.api.RagAnswerStreamHandle;
import com.liveclass.aiintegration.api.RagAnswerStreaming;
import com.liveclass.aiintegration.api.RagAnswerUpstreamException;
import com.liveclass.aiintegration.api.RagSseEvent;
import com.liveclass.aiintegration.config.RagApiProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/**
 * ai-api RAG SSE 어댑터(ADR-0047). 리액티브 스택을 끌어들이지 않고 JDK {@link HttpClient} +
 * virtual thread로 스트리밍한다 — backend는 JPA/blocking 모놀리스라 reactive 혼합을 피한다(ADR-0009).
 *
 * <p><b>서명 불일치를 막는 핵심 규칙</b>: body를 <b>한 번만</b> 직렬화해 그 바이트로 서명하고
 * 그 바이트를 그대로 전송한다({@link HttpRequest.BodyPublishers#ofByteArray}). 객체를 다시
 * 직렬화해 보내면 ai-api가 401을 낸다.
 *
 * <p>{@code issuedAtMs}는 전송 직전에 찍는다 — 서버 수신 시각과 60초 이상 차이나면 401이다.
 */
@Component
class RagAnswerHttpClient implements RagAnswerStreaming {

    private static final Logger log = LoggerFactory.getLogger(RagAnswerHttpClient.class);

    private final RagApiProperties properties;
    private final RagInternalSigner signer;
    private final HttpClient httpClient;
    // 전역 ObjectMapper 설정(NON_NULL·모듈 등)이 바뀌어도 wire가 흔들리지 않게 전용 매퍼를 쓴다.
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    RagAnswerHttpClient(RagApiProperties properties, RagInternalSigner signer) {
        this.properties = properties;
        this.signer = signer;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(properties.connectTimeout())
                .executor(Executors.newVirtualThreadPerTaskExecutor())
                .build();
    }

    @Override
    public Duration streamTimeout() {
        return properties.streamTimeout();
    }

    @Override
    public RagAnswerStreamHandle open(RagAnswerCommand command) {
        byte[] rawBody = jsonMapper.writeValueAsBytes(wire(command, System.currentTimeMillis()));
        HttpRequest request = HttpRequest.newBuilder(properties.answersStreamUri())
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .header("X-Internal-Signature", signer.sign(rawBody))
                .timeout(properties.streamTimeout())
                .POST(HttpRequest.BodyPublishers.ofByteArray(rawBody))
                .build();

        HttpResponse<InputStream> response;
        try {
            response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw RagAnswerUpstreamException.transport(e);
        } catch (IOException e) {
            // 질문 원문·서명은 로그에 남기지 않는다(ADR-0023 §9.2).
            log.warn("ai-api RAG 연결 실패 requestId={} reason={}", command.requestId(), e.toString());
            throw RagAnswerUpstreamException.transport(e);
        }

        if (response.statusCode() != 200) {
            closeQuietly(response.body());
            log.warn("ai-api RAG 시작 거부 requestId={} status={}", command.requestId(), response.statusCode());
            throw RagAnswerUpstreamException.ofStatus(response.statusCode());
        }
        return new InputStreamHandle(response.body());
    }

    /**
     * ai-api가 {@code extra="forbid"}라 <b>이 8개 필드만</b> 나가야 한다. UUID는 {@code toString()}이
     * 소문자 canonical이라 그대로 문자열로 싣는다.
     *
     * <p>{@code userId}는 <b>없으면 null로 나간다.</b> ai-api에서 optional이라 null이 허용되고, 그때는
     * 대화 기억 없이 예전과 똑같이 동작한다(fail-open). 빼는 대신 null로 두는 것은 wire 모양을 요청마다
     * 바꾸지 않기 위해서다 — 필드가 들쭉날쭉하면 서명 대상 바이트도 함께 흔들린다.
     */
    private static Wire wire(RagAnswerCommand command, long issuedAtMs) {
        return new Wire(
                command.requestId(),
                command.lessonId().toString(),
                command.curriculumId().toString(),
                command.sessionId().toString(),
                command.question(),
                command.contextTimeMs(),
                command.userId() == null ? null : command.userId().toString(),
                issuedAtMs);
    }

    /**
     * record 선언 순서가 곧 JSON 필드 순서다.
     *
     * <p><b>ai-api의 모델과 정확히 일치해야 한다.</b> {@code extra="forbid"}라 늘려도 거부되고, 필수
     * 필드가 빠져도 거부된다 — 그리고 그 거부는 422가 아니라 <b>400</b>으로 온다(ai-api가
     * RequestValidationError를 400으로 매핑한다). 실제로 {@code curriculumId}가 빠져 라이브 AI 질문이
     * 통째로 막혔다(2026-07-30~08-01).
     */
    private record Wire(
            String requestId,
            String lessonId,
            String curriculumId,
            String sessionId,
            String question,
            long contextTimeMs,
            String userId,
            long issuedAtMs) {
    }

    private static void closeQuietly(InputStream stream) {
        try {
            stream.close();
        } catch (IOException ignored) {
            // 이미 실패 경로 — 닫기 실패는 더 알릴 게 없다
        }
    }

    private record InputStreamHandle(InputStream body) implements RagAnswerStreamHandle {

        @Override
        public void forEachEvent(Consumer<RagSseEvent> consumer) throws IOException {
            SseFrameReader.read(body, consumer);
        }

        @Override
        public void close() {
            // 스트림을 닫으면 JDK HttpClient가 업스트림 교환을 취소한다 = 클라 취소의 백프레셔 전파.
            closeQuietly(body);
        }
    }
}
