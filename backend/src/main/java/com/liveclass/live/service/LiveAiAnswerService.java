package com.liveclass.live.service;

import com.liveclass.aiintegration.api.RagAnswerCommand;
import com.liveclass.aiintegration.api.RagAnswerRelay;
import com.liveclass.aiintegration.api.RagAnswerStreamHandle;
import com.liveclass.aiintegration.api.RagAnswerStreaming;
import com.liveclass.live.domain.LiveCaption;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.repository.LiveCaptionRepository;
import com.liveclass.live.repository.LiveSessionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.UUID;

/**
 * 브라우저 ↔ ai-api RAG SSE 중계(ADR-0047). 인가는 호출자(컨트롤러)가 {@link LiveAccessGuard}로 먼저
 * 끝내고, 여기서는 <b>서버가 신뢰할 수 있는 값만으로</b> 요청을 만들어 이벤트를 그대로 흘린다.
 *
 * <p>이벤트를 변환하지 않는다 — ai-api의 {@code answer.*} 이름·data를 그대로 브라우저로 보낸다.
 */
@Service
public class LiveAiAnswerService {

    private final LiveSessionRepository liveSessionRepository;
    private final LiveCaptionRepository liveCaptionRepository;
    private final RagAnswerStreaming ragAnswerStreaming;
    private final RagAnswerRelay ragAnswerRelay;
    private final LiveInteractionGuard interactionGuard;
    private final LiveAiAnswerRecorder recorder;
    private final com.liveclass.live.repository.LiveAiAnswerRepository aiAnswerRepository;

    public LiveAiAnswerService(LiveSessionRepository liveSessionRepository,
                               LiveCaptionRepository liveCaptionRepository,
                               RagAnswerStreaming ragAnswerStreaming,
                               RagAnswerRelay ragAnswerRelay,
                               LiveInteractionGuard interactionGuard,
                               LiveAiAnswerRecorder recorder,
                               com.liveclass.live.repository.LiveAiAnswerRepository aiAnswerRepository) {
        this.liveSessionRepository = liveSessionRepository;
        this.liveCaptionRepository = liveCaptionRepository;
        this.ragAnswerStreaming = ragAnswerStreaming;
        this.ragAnswerRelay = ragAnswerRelay;
        this.interactionGuard = interactionGuard;
        this.recorder = recorder;
        this.aiAnswerRepository = aiAnswerRepository;
    }

    /**
     * 서버 신뢰 값으로 요청을 조립한다.
     *
     * <ul>
     *   <li>{@code lessonId}·{@code curriculumId} — 세션에서 조회(클라 입력 금지). 커리큘럼은 ai-api의
     *       자료 검색 범위다(ADR-0042) — 레슨만 보내면 같은 커리큘럼의 다른 자료를 못 찾는다.</li>
     *   <li>{@code requestId} — 서버 생성. 클라가 재사용하면 ai-api가 409를 내므로 충돌을 원천 차단한다.</li>
     *   <li>{@code contextTimeMs} — 해당 세션 <b>최신 자막 행의 raw {@code streamElapsedMs}</b>. 자막이
     *       없으면 0. 세션-ms로 변환하지 않으므로 attempt 앵커 문제가 생기지 않는다.</li>
     * </ul>
     */
    @Transactional(readOnly = true)
    public RagAnswerCommand prepare(UUID sessionId, String question) {
        LiveSession session = liveSessionRepository.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
        // 종료된 세션도 저장된 전체 자막을 근거로 후속 질문할 수 있다.
        interactionGuard.requireInteractionAllowed(session);
        long contextTimeMs = liveCaptionRepository
                .findFirstBySessionIdAndEventTypeInOrderByOccurredAtDescIdDesc(sessionId, CaptionEvent.CONTEXT_TIME_TYPES)
                .map(LiveCaption::getStreamElapsedMs)
                .filter(ms -> ms != null && ms >= 0)
                .orElse(0L);
        return new RagAnswerCommand(
                UUID.randomUUID().toString(),
                session.getLessonId(),
                session.getCurriculumId(),
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

    /**
     * 이 세션에서 <b>내가</b> 한 질문 기록. 새로고침·재접속 복구용이다.
     *
     * <p>{@code userId}를 조건에서 빼면 같은 세션의 남의 질문이 함께 나온다 — 무엇을 모르는지가
     * 드러나므로 개인 범위를 레포지토리 메서드 이름에 박아 둔다.
     */
    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    public java.util.List<com.liveclass.live.domain.LiveAiAnswer> history(UUID sessionId, UUID userId) {
        return aiAnswerRepository.findBySessionIdAndUserIdOrderByAskedAtAscIdAsc(sessionId, userId);
    }

    /**
     * 열린 업스트림을 브라우저 SSE로 잇는다.
     *
     * <p>중계 규칙 자체는 다시보기와 공유한다({@link RagAnswerRelay}) — 이벤트 무변환, terminal 정확히
     * 하나, 취소 시 업스트림 닫기. 여기서 얹는 것은 <b>기록</b>뿐이다: 흘러가는 답변을 옆에서 받아 적어
     * 새로고침해도 대화가 남게 한다(기록 실패는 중계를 막지 않는다).
     */
    public SseEmitter relay(RagAnswerCommand command, RagAnswerStreamHandle handle, UUID askedBy) {
        return ragAnswerRelay.relay(command.requestId(), handle, recorder.start(command, askedBy));
    }
}
