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
import java.util.List;
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
 *   captionStartSessionMs = startedAt − liveSession.startedAt
 * </pre>
 *
 * <p><b>발화 벽시계를 그대로 쓴다</b>(ADR-0107). agent가 {@code segment.final}에 그 발화가 실제로
 * 시작·종료한 UTC 시각을 실어 주므로, 세션 원점만 빼면 정확한 세션-ms가 된다.
 *
 * <p>한때 {@code audioStartedAt + startStreamElapsedMs}로 같은 값을 구했다. <b>그 공식은 틀렸다</b> —
 * {@code startStreamElapsedMs}가 받은 오디오의 누적 길이라 무음이 빠지고, 운영 실측에서 세션마다
 * 0.6초~21초 어긋났다(ADR-0106). AI 근거 경로는 시각이 밀려도 티가 잘 안 나 오래 남아 있었다.
 *
 * <p>벽시계가 없는 발화는 <b>버린다</b>. 시간을 지어내느니 근거에서 빼는 편이 낫다
 * (ADR-0042 "앵커가 없는 발화는 제외"). 그래서 <b>이 기능이 배포되기 전에 녹화된 강의는 자막 근거가
 * 없다</b> — 자료·판서 근거만 남는다. 틀린 시각으로 "지금 이 부분"을 고르면 엉뚱한 곳을 인용해 답이
 * 틀리므로, 없는 편이 낫다고 판단했다.
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
        List<Caption> candidates = new ArrayList<>();
        for (LiveCaption row : liveCaptionRepository.findBySessionIdAndEventTypeOrderByIdAsc(
                session.getId(), CaptionEvent.TYPE_SEGMENT_FINAL)) {
            toSegment(row, sessionStart).ifPresent(candidates::add);
        }
        return ReplayCaptionWindow.select(candidates, questionSessionMs);
    }

    private Optional<Caption> toSegment(LiveCaption row, OffsetDateTime sessionStart) {
        if (row.getStartedAt() == null || row.getEndedAt() == null) {
            // 벽시계가 없으면 정확한 시각으로 가장하지 않고 버린다(ADR-0042·0107). 이 기능 이전에
            // 녹화된 강의가 여기 걸린다 — 자막 근거만 빠지고 자료·판서 근거는 그대로 간다.
            log.debug("발화 시각 없는 확정 자막 제외 sessionId={} eventId={}",
                    row.getSessionId(), row.getEventId());
            return Optional.empty();
        }
        long start = Duration.between(sessionStart, row.getStartedAt()).toMillis();
        long end = Duration.between(sessionStart, row.getEndedAt()).toMillis();
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
