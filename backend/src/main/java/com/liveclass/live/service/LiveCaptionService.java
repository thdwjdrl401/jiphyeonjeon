package com.liveclass.live.service;

import com.liveclass.live.domain.LiveCaption;
import com.liveclass.live.repository.LiveCaptionRepository;
import com.liveclass.live.web.dto.CaptionReloadItem;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * 자막 소비 멱등 적재(ADR-0043, CONTRACT §3-4). eventId 하나가 유일한 멱등키다 —
 * {@code existsByEventId} fast-path로 대부분의 중복을 거르고, 경합으로 SELECT를 둘 다 통과한 경우는
 * {@code saveAndFlush}의 UNIQUE 위반({@link DataIntegrityViolationException})을 흡수한다
 * ({@code AiCallbackService}·{@code ChatService}와 같은 패턴).
 *
 * <p>실제로 저장된 경우에만 {@link LiveCaptionStoredEvent}를 발행한다 → 커밋 후 리스너가 WS로 전달한다.
 * caption.stream.completed도 append-only로 함께 적재한다(스트림 종료 마커).
 */
@Service
public class LiveCaptionService {

    private static final Logger log = LoggerFactory.getLogger(LiveCaptionService.class);

    private final LiveCaptionRepository repository;
    private final ApplicationEventPublisher eventPublisher;
    private final SessionClockLookup sessionClockLookup;

    public LiveCaptionService(LiveCaptionRepository repository, ApplicationEventPublisher eventPublisher,
                              SessionClockLookup sessionClockLookup) {
        this.repository = repository;
        this.eventPublisher = eventPublisher;
        this.sessionClockLookup = sessionClockLookup;
    }

    /**
     * 저장된 자막을 세션-ms 순으로 리로드한다(CONTRACT §2 자막, ADR-0045). 각 행에 근사 세션-ms를
     * 계산해 WS payload와 같은 필드로 돌려준다 — FE가 새로고침·재연결 뒤 WS 누적기에 시드해 자막을 복원한다.
     * 인가(세션 참가자)는 호출자(컨트롤러)가 {@code LiveAccessGuard}로 처리한다.
     */
    @Transactional(readOnly = true)
    public List<CaptionReloadItem> reload(UUID sessionId) {
        return repository.findBySessionIdAndEventTypeInOrderByOccurredAtAscIdAsc(sessionId, CaptionEvent.RELAYED_TYPES)
                .stream()
                .map(row -> CaptionReloadItem.from(row, sessionClockLookup.approxSessionMs(sessionId, row.getOccurredAt())))
                .toList();
    }

    /**
     * 자막 이벤트를 멱등 적재한다. 새로 저장했으면 {@code true}(WS 발행), 이미 소비한 eventId면 {@code false}.
     *
     * @return 실제로 저장됐는지 여부(중복이면 false)
     */
    @Transactional
    public boolean persist(CaptionEvent event) {
        if (repository.existsByEventId(event.eventId())) {
            log.debug("자막 중복 무시 eventId={}", event.eventId());
            return false;
        }
        LiveCaption row = new LiveCaption();
        row.setEventId(event.eventId());
        row.setEventType(event.type());
        row.setSessionId(event.sessionId());
        row.setLessonId(event.lessonId());
        row.setSttSessionId(event.sttSessionId());
        row.setSequence(event.sequence());
        row.setLastSequence(event.lastSequence());
        row.setStreamElapsedMs(event.streamElapsedMs());
        row.setText(event.text());
        row.setReason(event.reason());
        row.setOccurredAt(event.occurredAt());
        row.setAudioStartedAt(event.audioStartedAt());
        row.setSegmentIndex(event.segmentIndex());
        row.setStartStreamElapsedMs(event.startStreamElapsedMs());
        row.setEndStreamElapsedMs(event.endStreamElapsedMs());
        row.setBoundaryReason(event.boundaryReason());
        try {
            repository.saveAndFlush(row);   // event_id UNIQUE 경합이면 예외 → 멱등 무시
        } catch (DataIntegrityViolationException race) {
            log.debug("자막 중복 무시(경합) eventId={}", event.eventId());
            return false;
        }

        // 표시 대상(delta·completed·segment.final, RELAYED_TYPES)만 WS로 발행한다. started(시간 앵커)는
        // 영속만 하고 흘리지 않는다 — FE 세그먼트 렌더는 segment.final의 권위 텍스트로 하고, 앵커 기반
        // 세션-ms 정밀화·seek는 후속 슬라이스다(ADR-0052).
        if (CaptionEvent.RELAYED_TYPES.contains(event.type())) {
            eventPublisher.publishEvent(LiveCaptionStoredEvent.from(event));
        }
        if (event.isCompleted()) {
            // 전역 키라 키 DEL은 하지 않는다(MAXLEN에 위임). 종료 마커 적재만 로그로 남긴다.
            log.info("자막 스트림 종료 sessionId={} sttSessionId={} lastSequence={}",
                    event.sessionId(), event.sttSessionId(), event.lastSequence());
        }
        return true;
    }
}
