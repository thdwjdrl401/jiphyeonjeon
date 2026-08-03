package com.liveclass.aiintegration.service;

import com.liveclass.aiintegration.domain.OutboxEvent;
import com.liveclass.aiintegration.domain.OutboxStatus;
import com.liveclass.aiintegration.repository.OutboxEventRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * outbox → RabbitMQ 릴레이(ADR-0036). PENDING 잡을 주기적으로 읽어 큐에 발행하고 PUBLISHED로 표시한다.
 * 발행 실패는 attemptCount++·백오프로 재시도, {@link #MAX_ATTEMPTS} 초과 시 FAILED(사실상 DLQ 대기).
 *
 * <p>목적지는 이벤트마다 다르고({@code destination} 컬럼) 배치는 <b>목적지별로</b> 뽑는다 —
 * 한 목적지가 밀려도 다른 목적지가 굶지 않는다(ADR-0073 §4).
 *
 * <p>발행 전용이라 큐 소비자(AI 워커)가 없어도 durable 큐에 메시지가 쌓인다. 스위치(material.embedding.enabled)가
 * 꺼져 있으면 애초에 outbox에 잡이 안 실리므로 이 릴레이는 빈 결과로 무해하게 돈다.
 */
@Component
public class OutboxRelay {

    private static final Logger log = LoggerFactory.getLogger(OutboxRelay.class);
    private static final int MAX_ATTEMPTS = 10;

    private final OutboxEventRepository outboxEventRepository;
    private final RabbitTemplate rabbitTemplate;

    public OutboxRelay(OutboxEventRepository outboxEventRepository, RabbitTemplate rabbitTemplate) {
        this.outboxEventRepository = outboxEventRepository;
        this.rabbitTemplate = rabbitTemplate;
    }

    /**
     * <b>목적지마다</b> 배치를 뽑는다. 전체에서 오래된 순으로 100건을 뽑던 방식은 한 목적지가 밀리면
     * 다른 목적지를 굶겼다 — 알림 팬아웃이 1,000건 쌓이면 방금 올린 자료의 임베딩 잡이 그 뒤에
     * 줄을 선다(머리 막힘). 목적지 수는 큐 종류만큼이라 조회가 하나 느는 값은 무시할 만하다.
     */
    @Scheduled(fixedDelayString = "${outbox.relay.fixed-delay-ms:5000}",
            initialDelayString = "${outbox.relay.initial-delay-ms:15000}")
    @Transactional
    public void publishPending() {
        OffsetDateTime cutoff = OffsetDateTime.now();
        for (String destination : outboxEventRepository.findPendingDestinations(OutboxStatus.PENDING, cutoff)) {
            List<OutboxEvent> batch = outboxEventRepository
                    .findTop100ByStatusAndDestinationAndNextAttemptAtLessThanEqualOrderByCreatedAtAsc(
                            OutboxStatus.PENDING, destination, cutoff);
            for (OutboxEvent event : batch) {
                publishOne(event);
            }
        }
    }

    private void publishOne(OutboxEvent event) {
        try {
            // 기본 익스체인지 + 라우팅키=큐이름. 목적지는 아웃박스 행이 들고 있다(ADR-0073 §4).
            rabbitTemplate.convertAndSend(event.getDestination(), event.getPayloadJson());
            event.setStatus(OutboxStatus.PUBLISHED);
            event.setPublishedAt(OffsetDateTime.now());
            log.info("outbox 발행 id={} dest={} type={}",
                    event.getId(), event.getDestination(), event.getEventType());
        } catch (RuntimeException e) {
            int attempts = (event.getAttemptCount() == null ? 0 : event.getAttemptCount()) + 1;
            event.setAttemptCount(attempts);
            event.setLastError(e.getMessage());
            if (attempts >= MAX_ATTEMPTS) {
                event.setStatus(OutboxStatus.FAILED);
                log.warn("outbox 발행 {}회 실패 → FAILED id={}: {}", attempts, event.getId(), e.getMessage());
            } else {
                // 지수 백오프(상한 5분). 다음 폴링에서 재시도.
                long backoffSec = Math.min(300, (long) Math.pow(2, attempts));
                event.setNextAttemptAt(OffsetDateTime.now().plusSeconds(backoffSec));
                log.warn("outbox 발행 실패(재시도 {}s 뒤) id={}: {}", backoffSec, event.getId(), e.getMessage());
            }
        }
    }
}
