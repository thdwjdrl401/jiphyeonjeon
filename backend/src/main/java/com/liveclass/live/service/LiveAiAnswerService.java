package com.liveclass.live.service;

import com.liveclass.aiintegration.api.RagAnswerCommand;
import com.liveclass.aiintegration.api.RagAnswerStreamHandle;
import com.liveclass.aiintegration.api.RagAnswerStreaming;
import com.liveclass.aiintegration.api.RagSseEvent;
import com.liveclass.live.domain.LiveCaption;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.repository.LiveCaptionRepository;
import com.liveclass.live.repository.LiveSessionRepository;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 브라우저 ↔ ai-api RAG SSE 중계(ADR-0047). 인가는 호출자(컨트롤러)가 {@link LiveAccessGuard}로 먼저
 * 끝내고, 여기서는 <b>서버가 신뢰할 수 있는 값만으로</b> 요청을 만들어 이벤트를 그대로 흘린다.
 *
 * <p>이벤트를 변환하지 않는다 — ai-api의 {@code answer.*} 이름·data를 그대로 브라우저로 보낸다.
 */
@Service
public class LiveAiAnswerService {

    private static final Logger log = LoggerFactory.getLogger(LiveAiAnswerService.class);

    /** 스트림이 시작된 뒤의 실패는 HTTP 상태로 못 알린다 — 규격 이벤트로 알린다. */
    private static final String ERROR_EVENT = "answer.error";

    private final LiveSessionRepository liveSessionRepository;
    private final LiveCaptionRepository liveCaptionRepository;
    private final RagAnswerStreaming ragAnswerStreaming;
    private final LiveInteractionGuard interactionGuard;
    private final long streamTimeoutMs;
    // 릴레이 펌프 전용. blocking read라 platform thread면 동시 질문 수만큼 스레드를 잡는다(ADR-0009).
    private final ExecutorService relayExecutor = Executors.newVirtualThreadPerTaskExecutor();

    public LiveAiAnswerService(LiveSessionRepository liveSessionRepository,
                               LiveCaptionRepository liveCaptionRepository,
                               RagAnswerStreaming ragAnswerStreaming,
                               LiveInteractionGuard interactionGuard) {
        this.liveSessionRepository = liveSessionRepository;
        this.liveCaptionRepository = liveCaptionRepository;
        this.ragAnswerStreaming = ragAnswerStreaming;
        this.interactionGuard = interactionGuard;
        // 브라우저 emitter 타임아웃은 업스트림 상한과 같아야 한다 — 짧으면 정상 응답이 중간에 끊긴다.
        this.streamTimeoutMs = ragAnswerStreaming.streamTimeout().toMillis();
    }

    /**
     * 서버 신뢰 값으로 요청을 조립한다.
     *
     * <ul>
     *   <li>{@code lessonId} — 세션에서 조회(클라 입력 금지).</li>
     *   <li>{@code requestId} — 서버 생성. 클라가 재사용하면 ai-api가 409를 내므로 충돌을 원천 차단한다.</li>
     *   <li>{@code contextTimeMs} — 해당 세션 <b>최신 자막 행의 raw {@code streamElapsedMs}</b>. 자막이
     *       없으면 0. 세션-ms로 변환하지 않으므로 attempt 앵커 문제가 생기지 않는다.</li>
     * </ul>
     */
    @Transactional(readOnly = true)
    public RagAnswerCommand prepare(UUID sessionId, String question) {
        LiveSession session = liveSessionRepository.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
        // ENDING은 HLS 지연 구간이므로 질문을 허용하고, ENDED부터 업스트림 호출 전에 닫는다.
        interactionGuard.requireOpen(session);
        long contextTimeMs = liveCaptionRepository
                .findFirstBySessionIdAndEventTypeInOrderByOccurredAtDescIdDesc(sessionId, CaptionEvent.CONTEXT_TIME_TYPES)
                .map(LiveCaption::getStreamElapsedMs)
                .filter(ms -> ms != null && ms >= 0)
                .orElse(0L);
        return new RagAnswerCommand(
                UUID.randomUUID().toString(),
                session.getLessonId(),
                sessionId,
                question,
                contextTimeMs);
    }

    /**
     * ai-api 스트림을 연다. 200을 받기 전에 실패하면
     * {@link com.liveclass.aiintegration.api.RagAnswerUpstreamException}을 던져 <b>SSE 헤더를 내보내기
     * 전에</b> 평범한 JSON 오류로 매핑되게 한다.
     */
    public RagAnswerStreamHandle open(RagAnswerCommand command) {
        return ragAnswerStreaming.open(command);
    }

    /** 열린 업스트림을 브라우저 SSE로 잇는다. 프레임마다 즉시 flush되도록 {@link SseEmitter}가 처리한다. */
    public SseEmitter relay(RagAnswerCommand command, RagAnswerStreamHandle handle) {
        SseEmitter emitter = new SseEmitter(streamTimeoutMs);
        // 클라 취소·타임아웃·오류 — 어느 쪽이든 업스트림을 닫아야 ai-api의 active 슬롯이 풀린다.
        emitter.onCompletion(handle::close);
        emitter.onTimeout(() -> {
            handle.close();
            emitter.complete();
        });
        emitter.onError(e -> handle.close());
        relayExecutor.execute(() -> pump(command, handle, emitter));
        return emitter;
    }

    private void pump(RagAnswerCommand command, RagAnswerStreamHandle handle, SseEmitter emitter) {
        AtomicBoolean sawTerminal = new AtomicBoolean(false);
        try {
            handle.forEachEvent(event -> {
                if (event.isTerminal()) {
                    sawTerminal.set(true);
                }
                write(emitter, event);
            });
            if (!sawTerminal.get()) {
                // 규격상 terminal이 정확히 하나 와야 한다. 없이 끊겼으면 FE가 영원히 기다리지 않게 알린다.
                write(emitter, proxyError(command.requestId(), "PROXY_STREAM_INCOMPLETE",
                        "AI 응답이 끝나기 전에 연결이 끊겼습니다. 다시 시도해 주세요."));
            }
            emitter.complete();
        } catch (IOException | UncheckedIOException e) {
            log.warn("RAG SSE 릴레이 중단 requestId={} reason={}", command.requestId(), e.toString());
            if (!sawTerminal.get()) {
                try {
                    write(emitter, proxyError(command.requestId(), "PROXY_UPSTREAM_FAILED",
                            "AI 응답 중계가 실패했습니다. 다시 시도해 주세요."));
                } catch (RuntimeException ignored) {
                    // 브라우저가 이미 끊긴 경우 — 알릴 대상이 없다
                }
            }
            emitter.complete();
        } catch (RuntimeException e) {
            log.warn("RAG SSE 릴레이 실패 requestId={} reason={}", command.requestId(), e.toString());
            emitter.completeWithError(e);
        } finally {
            handle.close();
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
