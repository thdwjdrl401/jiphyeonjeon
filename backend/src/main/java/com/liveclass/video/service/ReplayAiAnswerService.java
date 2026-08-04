package com.liveclass.video.service;

import com.liveclass.aiintegration.api.RagAnswerObserver;
import com.liveclass.aiintegration.api.RagAnswerRelay;
import com.liveclass.aiintegration.api.RagAnswerStreamHandle;
import com.liveclass.aiintegration.api.ReplayRagAnswerCommand;
import com.liveclass.aiintegration.api.ReplayRagAnswerStreaming;
import com.liveclass.live.api.AiAnswerJournal;
import com.liveclass.live.api.ReplayAiContext;
import com.liveclass.live.api.ReplayAiContextSource;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.UUID;

/**
 * 다시보기 AI 질의응답 중계(ADR-0042 · ADR-0075). 라이브(ADR-0047)와 구조는 같고 두 가지가 다르다.
 *
 * <ul>
 *   <li><b>인가</b>: 세션 참가자가 아니라 <b>재생 권한</b>이다 — 재생할 수 있으면 물어볼 수 있다.
 *       그래서 {@link ReplayPlaybackService#requirePlaybackContext}를 그대로 공유한다(게이트 복제 금지).</li>
 *   <li><b>문맥</b>: 좌표 하나가 아니라 <b>질문 시점 주변의 확정 자막</b>을 실어 보낸다. ai-api는 자막을
 *       다시 조회하지 않으므로 시간축 변환 책임이 우리에게 있다({@code ReplayAiContextSource}).</li>
 * </ul>
 *
 * <p>세션을 고를 규칙은 필요 없다. 재생 자산 하나가 세션 하나에서 나오므로
 * {@code asset.liveSessionId}가 곧 답이다 — 예전에 다시보기 AI를 막아 둔 이유("레슨에 세션이 여럿일 수
 * 있는데 고를 규칙이 없다", ADR-0047 §9)는 자산을 보면 사라진다.
 */
@Service
public class ReplayAiAnswerService {

    private final ReplayPlaybackService playbackService;
    private final ReplayAiContextSource contextSource;
    private final ReplayRagAnswerStreaming ragAnswerStreaming;
    private final RagAnswerRelay ragAnswerRelay;
    private final AiAnswerJournal journal;

    public ReplayAiAnswerService(ReplayPlaybackService playbackService,
                                 ReplayAiContextSource contextSource,
                                 ReplayRagAnswerStreaming ragAnswerStreaming,
                                 RagAnswerRelay ragAnswerRelay,
                                 AiAnswerJournal journal) {
        this.playbackService = playbackService;
        this.contextSource = contextSource;
        this.ragAnswerStreaming = ragAnswerStreaming;
        this.ragAnswerRelay = ragAnswerRelay;
        this.journal = journal;
    }

    /**
     * 서버가 신뢰할 수 있는 값만으로 v2 요청을 조립한다.
     *
     * <p>클라이언트가 보내는 것은 <b>질문과 재생 위치뿐</b>이다. {@code lessonId}는 경로, 나머지
     * — {@code sessionId}·{@code curriculumId}·자막·{@code requestId} — 는 전부 서버가 조회한다.
     * 클라가 세션이나 커리큘럼을 고를 수 있으면 수강하지 않은 강의의 근거를 열람할 수 있다.
     */
    public ReplayRagAnswerCommand prepare(UUID userId, UUID lessonId, String question, long playbackSessionMs) {
        ReplayPlaybackService.PlaybackContext playback =
                playbackService.requirePlaybackContext(userId, lessonId);
        if (playback.phase() == ReplayPlaybackService.PlaybackPhase.STARTING) {
            throw new RecordingStartingException("라이브 송출을 준비하고 있습니다. 잠시 후 다시 시도해 주세요.");
        }
        UUID sessionId = playback.session().sessionId();
        ReplayAiContext context = contextSource.resolve(sessionId, playbackSessionMs)
                .orElseThrow(() -> new ReplayNotFoundException("라이브 세션을 찾을 수 없습니다."));

        return new ReplayRagAnswerCommand(
                UUID.randomUUID().toString(),
                playback.asset().getLessonId(),
                context.curriculumId(),
                sessionId,
                question,
                playbackSessionMs,
                context.captions());
    }

    /**
     * ai-api v2 스트림을 연다. 200을 받기 전에 실패하면
     * {@link com.liveclass.aiintegration.api.RagAnswerUpstreamException}을 던져 <b>SSE 헤더를 내보내기
     * 전에</b> 평범한 JSON 오류로 매핑되게 한다.
     */
    public RagAnswerStreamHandle open(ReplayRagAnswerCommand command) {
        return ragAnswerStreaming.open(command);
    }

    /**
     * 브라우저로 잇는다. 답변은 라이브 질문과 <b>같은 표</b>에 남는다 — 사용자가 한 세션에서 물어본
     * 것은 라이브에서 물었든 다시보기에서 물었든 한 줄기로 보여야 한다.
     */
    public SseEmitter relay(ReplayRagAnswerCommand command, RagAnswerStreamHandle handle, UUID askedBy) {
        RagAnswerObserver observer = journal.start(
                command.requestId(), command.sessionId(), command.lessonId(), askedBy, command.question());
        return ragAnswerRelay.relay(command.requestId(), handle, observer);
    }
}
