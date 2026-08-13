package com.liveclass.aiintegration;

import com.liveclass.aiintegration.api.OutboxDestinations;
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
 * outbox → RabbitMQ 릴레이 계약(ADR-0036, ADR-0073 §4). RabbitTemplate을 목으로 대체해 브로커 없이
 * 검증한다: PENDING → 발행 후 PUBLISHED, 발행 실패 → attemptCount++·PENDING 유지(재시도),
 * 그리고 <b>한 목적지가 밀려도 다른 목적지가 굶지 않는다</b>.
 */
@SpringBootTest
@Transactional
class OutboxRelayTest {

    /**
     * 두 번째 목적지. <b>실제 큐 이름을 쓰지 않는다</b> — 알림 계약 테스트들은 커밋을 해야 해서
     * ({@code BEFORE_COMMIT} 발행을 검증하려면 롤백할 수 없다) 아웃박스 행을 남기고, 그 행이
     * {@code notification.fanout}으로 가 있으면 이 테스트의 발행 횟수·배치 상한 단언에 섞인다.
     *
     * <p>이 테스트가 보려는 것은 <b>목적지가 데이터인가</b>이지 특정 큐가 아니므로, 아무도 쓰지
     * 않는 이름을 쓴다.
     */
    private static final String OTHER_DESTINATION = "test.relay.other";

    @Autowired private OutboxRelay relay;
    @Autowired private OutboxPublisher publisher;
    @Autowired private OutboxEventRepository outboxEventRepository;

    @MockitoBean private RabbitTemplate rabbitTemplate;

    @Test
    void pending_event_is_published_to_queue_and_marked_published() {
        publisher.enqueue(OutboxDestinations.INGESTION_EMBED, "material_asset", "m1", "MATERIAL_EMBED_REQUESTED",
                "{\"taskType\":\"PPTX_EMBED\"}", "idem-publish", null);

        relay.publishPending();

        verify(rabbitTemplate).convertAndSend(eq("ingestion.embed"), any(Object.class));
        OutboxEvent saved = findByKey("idem-publish");
        assertThat(saved.getStatus()).isEqualTo(OutboxStatus.PUBLISHED);
        assertThat(saved.getPublishedAt()).isNotNull();
    }

    @Test
    void publish_failure_increments_attempt_and_stays_pending() {
        publisher.enqueue(OutboxDestinations.INGESTION_EMBED, "material_asset", "m2",
                "MATERIAL_EMBED_REQUESTED", "{}", "idem-fail", null);
        doThrow(new AmqpException("no broker")).when(rabbitTemplate).convertAndSend(anyString(), any(Object.class));

        relay.publishPending();

        OutboxEvent saved = findByKey("idem-fail");
        assertThat(saved.getStatus()).isEqualTo(OutboxStatus.PENDING);   // 아직 재시도 대상
        assertThat(saved.getAttemptCount()).isEqualTo(1);
        assertThat(saved.getLastError()).contains("no broker");
    }

    /** 목적지는 코드에 박힌 값이 아니라 이벤트가 들고 있는 값이다. */
    @Test
    void each_event_goes_to_its_own_destination() {
        publisher.enqueue(OutboxDestinations.INGESTION_EMBED, "material_asset", "m3",
                "MATERIAL_EMBED_REQUESTED", "{}", "idem-dest-embed", null);
        publisher.enqueue(OTHER_DESTINATION, "notification", "n1",
                "NOTIFICATION_FANOUT_REQUESTED", "{}", "idem-dest-fanout", null);

        relay.publishPending();

        verify(rabbitTemplate).convertAndSend(eq("ingestion.embed"), any(Object.class));
        verify(rabbitTemplate).convertAndSend(eq(OTHER_DESTINATION), any(Object.class));
    }

    /**
     * <b>자료 임베딩 회귀</b>(ADR-0073 §4). 알림이 배치 크기를 넘게 쌓인 <b>뒤</b>에 자료를 올려도
     * 임베딩 잡은 같은 주기에 나간다.
     *
     * <p>고치기 전 릴레이는 전체에서 오래된 순으로 100건만 뽑았다. 그래서 앞에 알림 120건이 있으면
     * 임베딩 잡은 100건 밖으로 밀려 <b>이번 주기에 발행되지 않았다</b> — 업로드하고 한참 뒤에야
     * 임베딩이 시작된다는 뜻이다. 이 테스트는 고치기 전 코드에서 실패한다.
     */
    @Test
    void a_flood_of_notifications_does_not_delay_the_embedding_job() {
        for (int i = 0; i < 120; i++) {
            publisher.enqueue(OTHER_DESTINATION, "notification", "n" + i,
                    "NOTIFICATION_FANOUT_REQUESTED", "{}", "idem-flood-" + i, null);
        }
        // 홍수 뒤에 들어온다 — 전체를 시간순으로 줄 세우면 120번째 뒤다.
        publisher.enqueue(OutboxDestinations.INGESTION_EMBED, "material_asset", "m4",
                "MATERIAL_EMBED_REQUESTED", "{\"taskType\":\"PPTX_EMBED\"}", "idem-flood-embed", null);

        relay.publishPending();

        assertThat(findByKey("idem-flood-embed").getStatus())
                .as("알림 홍수 뒤에 들어온 임베딩 잡도 같은 주기에 발행된다")
                .isEqualTo(OutboxStatus.PUBLISHED);
        verify(rabbitTemplate).convertAndSend(eq("ingestion.embed"), any(Object.class));
    }

    /**
     * 배치 상한은 <b>목적지마다</b> 100건이다. 상한 자체는 그대로 지켜야 한다 — 한 주기에 전부
     * 발행하려 들면 트랜잭션이 길어지고 실패 시 되돌릴 양이 커진다.
     */
    @Test
    void the_batch_cap_still_applies_per_destination() {
        for (int i = 0; i < 120; i++) {
            publisher.enqueue(OTHER_DESTINATION, "notification", "c" + i,
                    "NOTIFICATION_FANOUT_REQUESTED", "{}", "idem-cap-" + i, null);
        }

        relay.publishPending();

        long published = outboxEventRepository.findAll().stream()
                .filter(e -> e.getIdempotencyKey() != null && e.getIdempotencyKey().startsWith("idem-cap-"))
                .filter(e -> e.getStatus() == OutboxStatus.PUBLISHED)
                .count();
        assertThat(published).isEqualTo(100);
    }

    /**
     * 성공분은 <b>네이티브 UPDATE 한 문장</b>으로 넘어간다(ADR-0122). 엔티티를 고치지 않으므로,
     * 배치가 제대로 돌지 않으면 상태가 PENDING으로 남는다 — 즉 이 단언이 배치 UPDATE 자체를 본다.
     *
     * <p>{@code published_at}까지 함께 본다. 상태만 넘기고 시각을 빠뜨리면 "언제 나갔나"를 잃는데,
     * 그건 발행이 밀렸는지 브로커가 못 받았는지 가를 때 처음 보는 값이다.
     */
    @Test
    void the_batch_update_leaves_every_success_published_with_a_timestamp() {
        for (int i = 0; i < 5; i++) {
            publisher.enqueue(OTHER_DESTINATION, "notification", "b" + i,
                    "NOTIFICATION_FANOUT_REQUESTED", "{}", "idem-batch-" + i, null);
        }

        relay.publishPending();

        for (int i = 0; i < 5; i++) {
            OutboxEvent saved = findByKey("idem-batch-" + i);
            assertThat(saved.getStatus()).isEqualTo(OutboxStatus.PUBLISHED);
            assertThat(saved.getPublishedAt())
                    .as("배치 UPDATE도 발행 시각을 채운다")
                    .isNotNull();
        }
    }

    /**
     * <b>섞인 배치.</b> 성공분은 한 문장으로 묶고 실패분은 행마다 개별로 쓰는데, 두 경로가 같은
     * 트랜잭션에서 돌기 때문에 서로를 덮어쓸 여지가 있다 — 특히 성공분 UPDATE가 영속성 컨텍스트를
     * 비우므로 실패분의 아직 안 나간 변경이 <b>조용히 사라질</b> 수 있다.
     *
     * <p>그래서 한 목적지 안에 성공과 실패를 함께 놓고 양쪽을 다 확인한다.
     */
    @Test
    void a_mixed_batch_publishes_the_successes_and_keeps_the_failures_pending() {
        publisher.enqueue(OTHER_DESTINATION, "notification", "ok1",
                "NOTIFICATION_FANOUT_REQUESTED", "{}", "idem-mixed-ok", null);
        publisher.enqueue(OutboxDestinations.INGESTION_EMBED, "material_asset", "bad1",
                "MATERIAL_EMBED_REQUESTED", "{}", "idem-mixed-fail", null);
        doThrow(new AmqpException("no broker"))
                .when(rabbitTemplate).convertAndSend(eq("ingestion.embed"), any(Object.class));

        relay.publishPending();

        OutboxEvent ok = findByKey("idem-mixed-ok");
        assertThat(ok.getStatus()).isEqualTo(OutboxStatus.PUBLISHED);
        assertThat(ok.getPublishedAt()).isNotNull();

        OutboxEvent failed = findByKey("idem-mixed-fail");
        assertThat(failed.getStatus())
                .as("실패분은 성공분 배치에 휩쓸리지 않는다 — 아직 재시도 대상이다")
                .isEqualTo(OutboxStatus.PENDING);
        assertThat(failed.getAttemptCount())
                .as("실패분의 개별 UPDATE가 성공분 배치에 지워지지 않는다")
                .isEqualTo(1);
        assertThat(failed.getPublishedAt()).isNull();
    }

    private OutboxEvent findByKey(String idempotencyKey) {
        return outboxEventRepository.findAll().stream()
                .filter(e -> idempotencyKey.equals(e.getIdempotencyKey()))
                .findFirst().orElseThrow();
    }
}
