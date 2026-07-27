package com.liveclass.aiintegration;

import com.liveclass.aiintegration.api.OutboxPublisher;
import com.liveclass.aiintegration.domain.OutboxEvent;
import com.liveclass.aiintegration.domain.OutboxStatus;
import com.liveclass.aiintegration.repository.OutboxEventRepository;
import com.liveclass.aiintegration.service.OutboxRelay;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.AmqpException;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;

/**
 * outbox → RabbitMQ 릴레이 계약(ADR-0036). RabbitTemplate을 목으로 대체해 브로커 없이 검증한다:
 * PENDING → 발행 후 PUBLISHED, 발행 실패 → attemptCount++·PENDING 유지(재시도).
 */
@SpringBootTest
@Transactional
class OutboxRelayTest {

    @Autowired private OutboxRelay relay;
    @Autowired private OutboxPublisher publisher;
    @Autowired private OutboxEventRepository outboxEventRepository;

    @MockitoBean private RabbitTemplate rabbitTemplate;

    @Test
    void pending_event_is_published_to_queue_and_marked_published() {
        publisher.enqueue("material_asset", "m1", "MATERIAL_EMBED_REQUESTED",
                "{\"taskType\":\"PPTX_EMBED\"}", "idem-publish", null);

        relay.publishPending();

        verify(rabbitTemplate).convertAndSend(eq("ingestion.embed"), any(Object.class));
        OutboxEvent saved = findByKey("idem-publish");
        assertThat(saved.getStatus()).isEqualTo(OutboxStatus.PUBLISHED);
        assertThat(saved.getPublishedAt()).isNotNull();
    }

    @Test
    void publish_failure_increments_attempt_and_stays_pending() {
        publisher.enqueue("material_asset", "m2", "MATERIAL_EMBED_REQUESTED", "{}", "idem-fail", null);
        doThrow(new AmqpException("no broker")).when(rabbitTemplate).convertAndSend(anyString(), any(Object.class));

        relay.publishPending();

        OutboxEvent saved = findByKey("idem-fail");
        assertThat(saved.getStatus()).isEqualTo(OutboxStatus.PENDING);   // 아직 재시도 대상
        assertThat(saved.getAttemptCount()).isEqualTo(1);
        assertThat(saved.getLastError()).contains("no broker");
    }

    private OutboxEvent findByKey(String idempotencyKey) {
        return outboxEventRepository.findAll().stream()
                .filter(e -> idempotencyKey.equals(e.getIdempotencyKey()))
                .findFirst().orElseThrow();
    }
}
