package com.liveclass.aiintegration.service;

import com.liveclass.aiintegration.domain.ExternalEventInbox;
import com.liveclass.aiintegration.domain.ExternalEventInboxId;
import com.liveclass.aiintegration.domain.InboxStatus;
import com.liveclass.aiintegration.repository.ExternalEventInboxRepository;
import com.liveclass.aiintegration.web.dto.AiCallbackEvent;
import com.liveclass.aiintegration.api.AnnotationIndexResult;
import com.liveclass.learning.api.LessonGlossaryChangedEvent;
import com.liveclass.lesson.api.LessonMaterialManagement;
import org.springframework.context.ApplicationEventPublisher;
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
    private final ApplicationEventPublisher events;

    public AiCallbackService(ExternalEventInboxRepository inboxRepository,
                             LessonMaterialManagement lessonMaterialManagement,
                             ApplicationEventPublisher events) {
        this.inboxRepository = inboxRepository;
        this.lessonMaterialManagement = lessonMaterialManagement;
        this.events = events;
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
        applyAnnotationHighlightStatus(event);
        inbox.setStatus(InboxStatus.PROCESSED);
        inbox.setProcessedAt(OffsetDateTime.now());
        log.info("AI 콜백 처리 eventType={} materialId={}", event.eventType(), event.materialId());
    }

    /**
     * eventType → 강조 캡처 색인 상태(ADR-0074).
     *
     * <p>자료와 별개 축이다. 강조는 {@code materialId}가 없고 {@code highlightId}로 온다 — 같은
     * 필드에 밀어 넣으면 자료 상태를 엉뚱하게 덮어쓴다.
     */
    private void applyAnnotationHighlightStatus(AiCallbackEvent event) {
        String status = switch (event.eventType() == null ? "" : event.eventType()) {
            case "ANNOTATION_EMBEDDED" -> "READY";
            case "ANNOTATION_EMBED_FAILED" -> "FAILED";
            case "ANNOTATION_EMBEDDING" -> "PROCESSING";
            default -> null;
        };
        if (status != null && event.highlightId() != null) {
            events.publishEvent(new AnnotationIndexResult(UUID.fromString(event.highlightId()), status));
        }
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
            UUID materialId = UUID.fromString(event.materialId());
            lessonMaterialManagement.updateEmbeddingStatus(materialId, embeddingStatus);
            applyKeyTermStatus(event, materialId);
        }
    }

    /**
     * v2 callback의 용어 결과 projection. outputs가 없는 v1 callback은 기존 행의 상태를 건드리지 않는다.
     */
    private void applyKeyTermStatus(AiCallbackEvent event, UUID materialId) {
        if (event.outputs() == null || event.outputs().keyTermResult() == null) {
            return;
        }
        String status = event.outputs().keyTermResult().status();
        if (status == null) {
            return;
        }
        switch (status) {
            case "NOT_REQUESTED", "READY", "EMPTY", "FAILED" ->
                    lessonMaterialManagement.updateKeyTermStatus(materialId, status);
            default -> throw new IllegalArgumentException("지원하지 않는 keyTermResult.status입니다: " + status);
        }
        /*
         * 용어가 실제로 생겼을 때만 알린다. 진행 중인 라이브 화면은 강의 시작 전에 용어집을 한 번만
         * 받아 두므로(ADR-0064), 이 신호가 없으면 강의 도중에 끝난 추출 결과를 그 화면이 영영 못 본다.
         * EMPTY·FAILED는 화면에 더할 게 없고, 강의 밖에서 온 콜백이면 아래 수신자가 조용히 흘린다.
         */
        if ("READY".equals(status) && event.lessonId() != null) {
            events.publishEvent(new LessonGlossaryChangedEvent(
                    UUID.fromString(event.lessonId()), LessonGlossaryChangedEvent.Reason.MATERIAL_KEY_TERMS));
        }
    }
}
