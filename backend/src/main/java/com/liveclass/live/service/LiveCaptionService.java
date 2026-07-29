package com.liveclass.live.service;

import com.liveclass.live.domain.LiveCaption;
import com.liveclass.live.repository.LiveCaptionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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

    public LiveCaptionService(LiveCaptionRepository repository, ApplicationEventPublisher eventPublisher) {
        this.repository = repository;
        this.eventPublisher = eventPublisher;
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
        try {
            repository.saveAndFlush(row);   // event_id UNIQUE 경합이면 예외 → 멱등 무시
        } catch (DataIntegrityViolationException race) {
            log.debug("자막 중복 무시(경합) eventId={}", event.eventId());
            return false;
        }

        eventPublisher.publishEvent(LiveCaptionStoredEvent.from(event));
        if (event.isCompleted()) {
            // 전역 키라 키 DEL은 하지 않는다(MAXLEN에 위임). 종료 마커 적재만 로그로 남긴다.
            log.info("자막 스트림 종료 sessionId={} sttSessionId={} lastSequence={}",
                    event.sessionId(), event.sttSessionId(), event.lastSequence());
        }
        return true;
    }
}
