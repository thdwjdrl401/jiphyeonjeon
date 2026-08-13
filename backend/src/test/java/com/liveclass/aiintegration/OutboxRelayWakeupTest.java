package com.liveclass.aiintegration;

import com.liveclass.aiintegration.api.OutboxPublisher;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

/**
 * 커밋이 곧 릴레이의 신호다(ADR-0122).
 *
 * <p><b>{@code @Transactional}을 쓰지 않는다.</b> 트리거가 {@code afterCommit}에 걸려 있어서, 롤백되는
 * 테스트 트랜잭션 안에서는 <b>아예 실행되지 않는다</b> — 커밋이 일어나야 검증할 수 있다. 대신 이
 * 테스트가 만든 아웃박스 행을 뒤에서 직접 지운다.
 *
 * <p>목적지도 <b>실제 큐 이름을 쓰지 않는다</b>. 알림 계약 테스트들도 커밋을 하므로 아웃박스에 행을
 * 남기는데, 같은 목적지를 쓰면 여기의 발행 횟수 단언에 그 행들이 섞인다.
 */
@SpringBootTest(properties = {
        // <b>폴링을 꺼 둔다.</b> 켜 두면 트리거를 통째로 들어내도 다음 틱이 잡을 집어 가서 이 테스트가
        // 그대로 통과한다 — 즉 무엇도 지키지 못한다. 여기서 발행이 일어났다면 그건 커밋이 깨운 것뿐이다.
        "outbox.relay.initial-delay-ms=3600000",
        "outbox.relay.fixed-delay-ms=3600000"})
class OutboxRelayWakeupTest {

    private static final String DESTINATION = "test.relay.wakeup";

    /** 커밋이 없는 동안 아무것도 나가지 않았음을 확인하기 위해 트랜잭션을 붙잡아 두는 시간. */
    private static final long HOLD_MILLIS = 500;

    /** 깨우기는 다른 스레드에서 일어난다 — 느린 CI에서도 넉넉하되, 폴링 주기(30초)보다는 훨씬 짧게. */
    private static final long WAKEUP_TIMEOUT_MILLIS = 10_000;

    @Autowired private OutboxPublisher publisher;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private PlatformTransactionManager transactionManager;

    @MockitoBean private RabbitTemplate rabbitTemplate;

    @AfterEach
    void cleanUp() {
        jdbc.update("DELETE FROM core.outbox_events WHERE destination = ?", DESTINATION);
    }

    /**
     * 잡을 실으면 <b>폴링을 기다리지 않고</b> 나간다. 폴링 주기는 30초인데 이 테스트는 그보다 훨씬
     * 짧은 시간 안에 끝나야 하므로, 통과 자체가 "커밋이 릴레이를 깨웠다"는 증거다.
     */
    @Test
    void a_committed_enqueue_wakes_the_relay_without_waiting_for_the_poll() {
        String key = enqueueOne();

        verify(rabbitTemplate, timeout(WAKEUP_TIMEOUT_MILLIS)).convertAndSend(eq(DESTINATION), any(Object.class));
        awaitPublished(key);
    }

    /**
     * <b>커밋된 뒤에만</b> 나간다. {@code beforeCommit}에 걸었다면 릴레이는 아직 커밋되지 않은 행을
     * 읽으러 가 아무것도 못 보고 돌아왔을 것이다 — 깨운 값이 0이 되고 그 잡은 폴링을 기다린다.
     *
     * <p>업무 트랜잭션을 열어 둔 채로 잡을 싣고, 그동안 브로커로 아무것도 가지 않는 것을 확인한 뒤
     * 커밋한다. 커밋 이후에야 발행이 일어난다.
     */
    @Test
    void nothing_reaches_the_broker_until_the_business_transaction_commits() {
        String key = UUID.randomUUID().toString();
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            publisher.enqueue(DESTINATION, "material_asset", "wake-open",
                    "TEST_WAKEUP_REQUESTED", "{}", key, null);
            sleep(HOLD_MILLIS);
            verify(rabbitTemplate, never()).convertAndSend(eq(DESTINATION), any(Object.class));
        });

        verify(rabbitTemplate, timeout(WAKEUP_TIMEOUT_MILLIS)).convertAndSend(eq(DESTINATION), any(Object.class));
        awaitPublished(key);
    }

    private String enqueueOne() {
        String key = UUID.randomUUID().toString();
        publisher.enqueue(DESTINATION, "material_asset", "wake-1",
                "TEST_WAKEUP_REQUESTED", "{}", key, null);
        return key;
    }

    /**
     * 발행 표시는 릴레이 트랜잭션이 커밋돼야 보이므로, 브로커 호출을 확인한 뒤에도 잠깐 늦을 수
     * 있다. 상태와 함께 {@code published_at}까지 본다 — 배치 UPDATE가 시각을 빠뜨리면 여기서 걸린다.
     */
    private void awaitPublished(String idempotencyKey) {
        long deadline = System.currentTimeMillis() + WAKEUP_TIMEOUT_MILLIS;
        while (System.currentTimeMillis() < deadline) {
            if ("PUBLISHED".equals(statusOf(idempotencyKey))) {
                assertThat(publishedAtOf(idempotencyKey)).isNotNull();
                return;
            }
            sleep(50);
        }
        assertThat(statusOf(idempotencyKey))
                .as("커밋 뒤 깨어난 릴레이가 이 잡을 발행했어야 한다")
                .isEqualTo("PUBLISHED");
    }

    private String statusOf(String idempotencyKey) {
        return jdbc.queryForObject(
                "SELECT status FROM core.outbox_events WHERE idempotency_key = ?", String.class, idempotencyKey);
    }

    private Object publishedAtOf(String idempotencyKey) {
        return jdbc.queryForObject(
                "SELECT published_at FROM core.outbox_events WHERE idempotency_key = ?", Object.class, idempotencyKey);
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }
}
