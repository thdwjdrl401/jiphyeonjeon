package com.liveclass.aiintegration.api;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 열린 ai-api 스트림을 브라우저 SSE로 잇는 공용 릴레이(ADR-0047 → ADR-0075로 확장).
 *
 * <p>라이브(v1)와 다시보기(v2)가 <b>같은 코드</b>로 중계한다. 두 경로의 차이는 업스트림 요청 모양뿐이고
 * 중계 규칙 — 이벤트 무변환, terminal 정확히 하나, 취소 시 업스트림 닫기 — 은 완전히 같다. 예전에는
 * 이 펌프가 live 모듈 안에 있어 video가 쓸 수 없었다.
 *
 * <p><b>이벤트를 변환하지 않는다</b> — ai-api의 {@code answer.*} 이름·data를 그대로 흘린다.
 */
@Component
public class RagAnswerRelay {

    private static final Logger log = LoggerFactory.getLogger(RagAnswerRelay.class);

    /** 스트림이 시작된 뒤의 실패는 HTTP 상태로 못 알린다 — 규격 이벤트로 알린다. */
    private static final String ERROR_EVENT = "answer.error";

    private final long streamTimeoutMs;
    // 릴레이 펌프 전용. blocking read라 platform thread면 동시 질문 수만큼 스레드를 잡는다(ADR-0009).
    private final ExecutorService relayExecutor = Executors.newVirtualThreadPerTaskExecutor();

    public RagAnswerRelay(RagAnswerStreaming ragAnswerStreaming) {
        // 브라우저 emitter 타임아웃은 업스트림 상한과 같아야 한다 — 짧으면 정상 응답이 중간에 끊긴다.
        this.streamTimeoutMs = ragAnswerStreaming.streamTimeout().toMillis();
    }

    /**
     * 업스트림을 브라우저로 잇는다. 프레임마다 즉시 flush되도록 {@link SseEmitter}가 처리한다.
     *
     * @param requestId 로그·프록시 오류 봉투에 실을 요청 식별자
     * @param observer  기록 등 곁다리 소비자. 없으면 {@link RagAnswerObserver#NONE}
     */
    public SseEmitter relay(String requestId, RagAnswerStreamHandle handle, RagAnswerObserver observer) {
        SseEmitter emitter = new SseEmitter(streamTimeoutMs);
        // 클라 취소·타임아웃·오류 — 어느 쪽이든 업스트림을 닫아야 ai-api의 active 슬롯이 풀린다.
        emitter.onCompletion(handle::close);
        emitter.onTimeout(() -> {
            handle.close();
            emitter.complete();
        });
        emitter.onError(e -> handle.close());
        relayExecutor.execute(() -> pump(requestId, handle, emitter, observer));
        return emitter;
    }

    private void pump(String requestId, RagAnswerStreamHandle handle, SseEmitter emitter,
                      RagAnswerObserver observer) {
        AtomicBoolean sawTerminal = new AtomicBoolean(false);
        try {
            handle.forEachEvent(event -> {
                if (event.isTerminal()) {
                    sawTerminal.set(true);
                }
                observer.observe(event);
                write(emitter, event);
            });
            if (!sawTerminal.get()) {
                // 규격상 terminal이 정확히 하나 와야 한다. 없이 끊겼으면 FE가 영원히 기다리지 않게 알린다.
                write(emitter, proxyError(requestId, "PROXY_STREAM_INCOMPLETE",
                        "AI 응답이 끝나기 전에 연결이 끊겼습니다. 다시 시도해 주세요."));
            }
            emitter.complete();
        } catch (IOException | UncheckedIOException e) {
            log.warn("RAG SSE 릴레이 중단 requestId={} reason={}", requestId, e.toString());
            if (!sawTerminal.get()) {
                try {
                    write(emitter, proxyError(requestId, "PROXY_UPSTREAM_FAILED",
                            "AI 응답 중계가 실패했습니다. 다시 시도해 주세요."));
                } catch (RuntimeException ignored) {
                    // 브라우저가 이미 끊긴 경우 — 알릴 대상이 없다
                }
            }
            emitter.complete();
        } catch (RuntimeException e) {
            log.warn("RAG SSE 릴레이 실패 requestId={} reason={}", requestId, e.toString());
            emitter.completeWithError(e);
        } finally {
            handle.close();
            // terminal을 못 본 채 끊겼어도 남긴다 — 받은 데까지는 새로고침 뒤에도 읽을 수 있어야 한다.
            observer.finish();
        }
    }

    /**
     * data는 이미 완성된 JSON 문자열이라 {@link MediaType#TEXT_PLAIN}으로 <b>그대로</b> 쓴다 —
     * 다시 JSON 변환하면 문자열로 이중 인코딩된다.
     */
    private void write(SseEmitter emitter, RagSseEvent event) {
        try {
            SseEmitter.SseEventBuilder builder = SseEmitter.event();
            if (event.name() != null) {
                builder = builder.name(event.name());
            }
            emitter.send(builder.data(event.data(), MediaType.TEXT_PLAIN));
        } catch (IOException e) {
            // 브라우저가 끊었다 = 취소. 위에서 업스트림을 닫도록 언체크로 올린다.
            throw new UncheckedIOException(e);
        }
    }

    private RagSseEvent proxyError(String requestId, String code, String message) {
        // ai-api의 answer.error와 같은 모양({requestId,code,message,retryable})이라 FE 분기가 하나다.
        String data = "{\"requestId\":\"%s\",\"code\":\"%s\",\"message\":\"%s\",\"retryable\":true}"
                .formatted(requestId, code, message);
        return new RagSseEvent(ERROR_EVENT, data);
    }

    @PreDestroy
    void shutdown() {
        relayExecutor.shutdownNow();
    }
}
