package com.liveclass.aiintegration.service;

import com.liveclass.aiintegration.api.RagAnswerStreamHandle;
import com.liveclass.aiintegration.api.RagAnswerUpstreamException;
import com.liveclass.aiintegration.api.RagSseEvent;
import com.liveclass.aiintegration.api.ReplayRagAnswerCommand;
import com.liveclass.aiintegration.api.ReplayRagAnswerStreaming;
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
import java.util.List;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** Replay v2 전용 HTTP 어댑터. v1 wire를 변경하지 않고 과거 자막을 body에 포함한다. */
@Component
class ReplayRagAnswerHttpClient implements ReplayRagAnswerStreaming {

    private static final Logger log = LoggerFactory.getLogger(ReplayRagAnswerHttpClient.class);

    private final RagApiProperties properties;
    private final RagInternalSigner signer;
    private final HttpClient httpClient;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    ReplayRagAnswerHttpClient(RagApiProperties properties, RagInternalSigner signer) {
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
    public RagAnswerStreamHandle open(ReplayRagAnswerCommand command) {
        byte[] rawBody = jsonMapper.writeValueAsBytes(wire(command, System.currentTimeMillis()));
        HttpRequest request = HttpRequest.newBuilder(properties.replayAnswersStreamUri())
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
            log.warn("ai-api Replay RAG 연결 실패 requestId={} reason={}", command.requestId(), e.toString());
            throw RagAnswerUpstreamException.transport(e);
        }

        if (response.statusCode() != 200) {
            closeQuietly(response.body());
            log.warn("ai-api Replay RAG 시작 거부 requestId={} status={}",
                    command.requestId(), response.statusCode());
            throw RagAnswerUpstreamException.ofStatus(response.statusCode());
        }
        return new InputStreamHandle(response.body());
    }

    private static Wire wire(ReplayRagAnswerCommand command, long issuedAtMs) {
        List<CaptionWire> captions = command.captions().stream()
                .map(caption -> new CaptionWire(
                        caption.sttSessionId(),
                        caption.segmentIndex(),
                        caption.startSessionMs(),
                        caption.endSessionMs(),
                        caption.text()))
                .toList();
        return new Wire(
                command.requestId(),
                command.lessonId().toString(),
                command.curriculumId().toString(),
                command.sessionId().toString(),
                command.question(),
                new ContextWire("REPLAY", command.questionSessionMs(), captions),
                issuedAtMs);
    }

    private static void closeQuietly(InputStream stream) {
        try {
            stream.close();
        } catch (IOException ignored) {
            // 이미 실패 경로다.
        }
    }

    private record Wire(
            String requestId,
            String lessonId,
            String curriculumId,
            String sessionId,
            String question,
            ContextWire context,
            long issuedAtMs) {
    }

    private record ContextWire(String mode, long questionSessionMs, List<CaptionWire> captions) {
    }

    private record CaptionWire(
            String sttSessionId,
            int segmentIndex,
            long startSessionMs,
            long endSessionMs,
            String text) {
    }

    private record InputStreamHandle(InputStream body) implements RagAnswerStreamHandle {

        @Override
        public void forEachEvent(Consumer<RagSseEvent> consumer) throws IOException {
            SseFrameReader.read(body, consumer);
        }

        @Override
        public void close() {
            closeQuietly(body);
        }
    }
}
