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

import java.time.Duration;
import java.time.OffsetDateTime;

@Service
public class OutboxPublisherService implements OutboxPublisher {

    private static final Logger log = LoggerFactory.getLogger(OutboxPublisherService.class);

    private final OutboxEventRepository outboxEventRepository;
    private final OutboxRelayTrigger relayTrigger;

    public OutboxPublisherService(OutboxEventRepository outboxEventRepository,
                                  OutboxRelayTrigger relayTrigger) {
        this.outboxEventRepository = outboxEventRepository;
        this.relayTrigger = relayTrigger;
    }

    @Override
    @Transactional
    public void enqueueAfter(String destination, String aggregateType, String aggregateId, String eventType,
                             String payloadJson, String idempotencyKey, String correlationId, Duration delay) {
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
        // 지연이 있으면 그만큼 미뤄 둔다. 릴레이는 next_attempt_at이 지난 행만 집으므로
        // 이 한 줄이 곧 "나중에 발행"이다(ADR-0128).
        event.setNextAttemptAt(delay == null || delay.isNegative() || delay.isZero()
                ? OffsetDateTime.now()
                : OffsetDateTime.now().plus(delay));
        try {
            outboxEventRepository.saveAndFlush(event);
        } catch (DataIntegrityViolationException e) {
            // 동시 요청 레이스 — UNIQUE(idempotency_key) 위반. 이미 실렸으니 성공으로 본다.
            log.debug("outbox 동시 중복 무시 idempotencyKey={}", idempotencyKey);
            return;
        }
        log.info("outbox 적재 dest={} type={} aggId={} idempotencyKey={}",
                destination, eventType, aggregateId, idempotencyKey);
        /*
         * 커밋된 뒤에 릴레이를 깨운다(ADR-0122). 여기서 바로 발행하지 않는 이유가 아웃박스의 존재
         * 이유 그 자체다 — 이 트랜잭션은 아직 롤백될 수 있고, 롤백된 일에 대한 메시지가 브로커에
         * 남으면 되돌릴 방법이 없다. 신호만 예약하고 실제 발행은 커밋 뒤 다른 스레드가 한다.
         *
         * 중복으로 걸러진 경우(위 두 return)에는 깨우지 않는다. 새로 실린 잡이 없으므로 깨워도
         * 빈 배치를 훑을 뿐이다.
         */
        relayTrigger.wakeAfterCommit();
    }
}
