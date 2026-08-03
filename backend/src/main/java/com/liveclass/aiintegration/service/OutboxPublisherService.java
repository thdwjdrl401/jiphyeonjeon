package com.liveclass.aiintegration.service;

import com.liveclass.aiintegration.api.OutboxPublisher;
import com.liveclass.aiintegration.domain.OutboxEvent;
import com.liveclass.aiintegration.domain.OutboxStatus;
import com.liveclass.aiintegration.repository.OutboxEventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;

@Service
public class OutboxPublisherService implements OutboxPublisher {

    private static final Logger log = LoggerFactory.getLogger(OutboxPublisherService.class);

    private final OutboxEventRepository outboxEventRepository;

    public OutboxPublisherService(OutboxEventRepository outboxEventRepository) {
        this.outboxEventRepository = outboxEventRepository;
    }

    @Override
    @Transactional
    public void enqueue(String destination, String aggregateType, String aggregateId, String eventType,
                        String payloadJson, String idempotencyKey, String correlationId) {
        // 멱등: 같은 idempotencyKey가 이미 있으면(같은 자료 재요청 등) 새로 넣지 않는다.
        if (outboxEventRepository.existsByIdempotencyKey(idempotencyKey)) {
            log.debug("outbox 중복 무시 idempotencyKey={}", idempotencyKey);
            return;
        }
        OutboxEvent event = new OutboxEvent();
        event.setDestination(destination);
        event.setAggregateType(aggregateType);
        event.setAggregateId(aggregateId);
        event.setEventType(eventType);
        event.setPayloadJson(payloadJson);
        event.setStatus(OutboxStatus.PENDING);
        event.setIdempotencyKey(idempotencyKey);
        event.setCorrelationId(correlationId);
        event.setAttemptCount(0);
        event.setNextAttemptAt(OffsetDateTime.now());
        try {
            outboxEventRepository.saveAndFlush(event);
        } catch (DataIntegrityViolationException e) {
            // 동시 요청 레이스 — UNIQUE(idempotency_key) 위반. 이미 실렸으니 성공으로 본다.
            log.debug("outbox 동시 중복 무시 idempotencyKey={}", idempotencyKey);
            return;
        }
        log.info("outbox 적재 dest={} type={} aggId={} idempotencyKey={}",
                destination, eventType, aggregateId, idempotencyKey);
    }
}
