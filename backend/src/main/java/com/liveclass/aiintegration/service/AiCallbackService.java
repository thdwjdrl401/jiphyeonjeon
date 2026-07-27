package com.liveclass.aiintegration.service;

import com.liveclass.aiintegration.domain.ExternalEventInbox;
import com.liveclass.aiintegration.domain.ExternalEventInboxId;
import com.liveclass.aiintegration.domain.InboxStatus;
import com.liveclass.aiintegration.repository.ExternalEventInboxRepository;
import com.liveclass.aiintegration.web.dto.AiCallbackEvent;
import com.liveclass.lesson.api.LessonMaterialManagement;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * AI 워커 콜백 처리(ADR-0036, CONTRACT §3-2). external_event_inbox로 멱등 수신 —
 * (source, eventId) 복합키라 같은 이벤트가 여러 번 와도 한 번만 반영한다. eventType으로 자료 임베딩 상태를 옮긴다.
 */
@Service
public class AiCallbackService {

    private static final Logger log = LoggerFactory.getLogger(AiCallbackService.class);
    private static final String SOURCE = "ai-worker";

    private final ExternalEventInboxRepository inboxRepository;
    private final LessonMaterialManagement lessonMaterialManagement;

    public AiCallbackService(ExternalEventInboxRepository inboxRepository,
                             LessonMaterialManagement lessonMaterialManagement) {
        this.inboxRepository = inboxRepository;
        this.lessonMaterialManagement = lessonMaterialManagement;
    }

    @Transactional
    public void handle(AiCallbackEvent event, String rawJson) {
        // 멱등 사전 확인(fast path) — 대부분의 중복은 여기서 걸러 flush 실패로 세션이 오염되지 않게 한다.
        if (inboxRepository.existsById(new ExternalEventInboxId(SOURCE, event.eventId()))) {
            log.debug("AI 콜백 중복 무시 eventId={}", event.eventId());
            return;
        }
        ExternalEventInbox inbox = new ExternalEventInbox();
        inbox.setSource(SOURCE);
        inbox.setSourceEventId(event.eventId());
        inbox.setEventType(event.eventType());
        inbox.setAggregateRef(event.materialId());
        inbox.setPayloadJson(rawJson);
        inbox.setStatus(InboxStatus.RECEIVED);
        inbox.setReceivedAt(OffsetDateTime.now());
        try {
            inboxRepository.saveAndFlush(inbox);   // (source, eventId) 중복이면 예외 → 멱등 무시
        } catch (DataIntegrityViolationException e) {
            log.debug("AI 콜백 중복 무시 eventId={}", event.eventId());
            return;
        }

        applyEmbeddingStatus(event);
        inbox.setStatus(InboxStatus.PROCESSED);
        inbox.setProcessedAt(OffsetDateTime.now());
        log.info("AI 콜백 처리 eventType={} materialId={}", event.eventType(), event.materialId());
    }

    /** eventType → 자료 임베딩 상태. 모르는 eventType은 inbox에만 남기고 무시(확장 여지). */
    private void applyEmbeddingStatus(AiCallbackEvent event) {
        String embeddingStatus = switch (event.eventType() == null ? "" : event.eventType()) {
            case "MATERIAL_EMBEDDED" -> "READY";
            case "MATERIAL_EMBED_FAILED" -> "FAILED";
            case "MATERIAL_EMBEDDING" -> "PROCESSING";
            default -> null;
        };
        if (embeddingStatus != null && event.materialId() != null) {
            lessonMaterialManagement.updateEmbeddingStatus(UUID.fromString(event.materialId()), embeddingStatus);
        }
    }
}
