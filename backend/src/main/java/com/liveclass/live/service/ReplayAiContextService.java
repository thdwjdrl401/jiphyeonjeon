package com.liveclass.live.service;

import com.liveclass.aiintegration.api.ReplayRagAnswerCommand.Caption;
import com.liveclass.live.api.ReplayAiContext;
import com.liveclass.live.api.ReplayAiContextSource;
import com.liveclass.live.domain.LiveCaption;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.repository.LiveCaptionRepository;
import com.liveclass.live.repository.LiveSessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 다시보기 AI 질문의 자막 문맥을 만든다(ADR-0042). <b>여기가 시간축이 바뀌는 유일한 지점</b>이다.
 *
 * <p>자막 행의 원좌표는 attempt-local {@code streamElapsedMs}(agent의 첫 오디오 프레임 = 0)이고,
 * 재생 위치는 세션 상대 ms(라이브 시작 = 0)다. 둘을 잇는 것이 {@code caption.stream.started}의
 * {@code audioStartedAt}(그 attempt의 0이 절대 몇 시였나)이다:
 *
 * <pre>
 *   attemptStartSessionMs = audioStartedAt − liveSession.startedAt
 *   captionStartSessionMs = attemptStartSessionMs + startStreamElapsedMs
 * </pre>
 *
 * <p>이 변환은 CONTRACT §3-4가 금지한 "앵커 없는 {@code streamElapsedMs}→세션ms 환산"이 <b>아니다</b> —
 * 금지된 것은 앵커 없이 짐작하는 것이고, 여기서는 실제 앵커 행을 읽어 적용한다. 앵커가 없는 attempt의
 * 발화는 <b>버린다</b>. 시간을 지어내느니 근거에서 빼는 편이 낫다(ADR-0042 "앵커가 없는 발화는 제외").
 */
@Service
public class ReplayAiContextService implements ReplayAiContextSource {

    private static final Logger log = LoggerFactory.getLogger(ReplayAiContextService.class);

    private final LiveSessionRepository liveSessionRepository;
    private final LiveCaptionRepository liveCaptionRepository;

    public ReplayAiContextService(LiveSessionRepository liveSessionRepository,
                                  LiveCaptionRepository liveCaptionRepository) {
        this.liveSessionRepository = liveSessionRepository;
        this.liveCaptionRepository = liveCaptionRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<ReplayAiContext> resolve(UUID sessionId, long questionSessionMs) {
        return liveSessionRepository.findById(sessionId)
                .map(session -> new ReplayAiContext(
                        session.getCurriculumId(),
                        captions(session, questionSessionMs)));
    }

    private List<Caption> captions(LiveSession session, long questionSessionMs) {
        OffsetDateTime sessionStart = session.getStartedAt();
        if (sessionStart == null) {
            // 시작한 적 없는 세션엔 세션 시계의 원점이 없다 — 자막이 있을 수도 없다.
            return List.of();
        }
        Map<String, Long> anchors = anchors(session.getId(), sessionStart);
        if (anchors.isEmpty()) {
            return List.of();
        }
        List<Caption> candidates = new ArrayList<>();
        for (LiveCaption row : liveCaptionRepository.findBySessionIdAndEventTypeOrderByIdAsc(
                session.getId(), CaptionEvent.TYPE_SEGMENT_FINAL)) {
            toSegment(row, anchors).ifPresent(candidates::add);
        }
        return ReplayCaptionWindow.select(candidates, questionSessionMs);
    }

    /** attempt(sttSessionId) → 그 attempt의 0이 세션 시계로 몇 ms인지. */
    private Map<String, Long> anchors(UUID sessionId, OffsetDateTime sessionStart) {
        Map<String, Long> anchors = new HashMap<>();
        for (LiveCaption row : liveCaptionRepository.findBySessionIdAndEventTypeOrderByIdAsc(
                sessionId, CaptionEvent.TYPE_STARTED)) {
            if (row.getSttSessionId() == null || row.getAudioStartedAt() == null) {
                continue;
            }
            // 같은 attempt의 started가 두 번 오면 첫 것을 쓴다 — 0의 정의가 바뀌면 안 된다.
            anchors.putIfAbsent(row.getSttSessionId(),
                    Duration.between(sessionStart, row.getAudioStartedAt()).toMillis());
        }
        return anchors;
    }

    private Optional<Caption> toSegment(LiveCaption row, Map<String, Long> anchors) {
        Long anchor = row.getSttSessionId() == null ? null : anchors.get(row.getSttSessionId());
        if (anchor == null || row.getStartStreamElapsedMs() == null || row.getEndStreamElapsedMs() == null) {
            // 앵커·좌표가 없으면 정확한 시각으로 가장하지 않고 버린다(ADR-0042).
            log.debug("앵커 없는 확정 자막 제외 sessionId={} eventId={}", row.getSessionId(), row.getEventId());
            return Optional.empty();
        }
        long start = anchor + row.getStartStreamElapsedMs();
        long end = anchor + row.getEndStreamElapsedMs();
        if (end < 0) {
            return Optional.empty();   // 세션 시작 전의 발화 — 재생 축에 자리가 없다
        }
        return Optional.of(new Caption(
                row.getSttSessionId(),
                row.getSegmentIndex() == null ? 0 : row.getSegmentIndex().intValue(),
                Math.max(0, start),
                end,
                row.getText() == null ? "" : row.getText()));
    }
}
