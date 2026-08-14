package com.liveclass.aiintegration;

import com.liveclass.aiintegration.api.OutboxPublisher;
import com.liveclass.aiintegration.config.OutboxAsyncConfig;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;

/**
 * <b>깨우기가 터져도 업무는 성공한다</b>(ADR-0122).
 *
 * <p>{@code afterCommit}에서 던진 예외는 커밋을 부른 쪽으로 그대로 전파된다. 즉 여기서 삼키지 않으면
 * <b>이미 커밋된 수강 승인이 호출자에게는 실패로 보인다</b> — 되돌릴 수도 없는 상태로. 깨우기는
 * 최선 노력이고 폴링이 안전망이므로, 한 번 놓치는 것은 늦어지는 것일 뿐이다.
 *
 * <p>실행기를 목으로 바꿔 <b>거절</b>을 만든다(종료 중이거나 자원이 없을 때 실제로 나는 예외다).
 * 별도 클래스인 것은 이 목이 컨텍스트 전체에 걸리기 때문이다 — 같은 클래스에 두면 진짜로 깨우는
 * 테스트({@code OutboxRelayWakeupTest})가 성립하지 않는다.
 */
@SpringBootTest(properties = {
        // 이 테스트의 단언은 "깨우지 못해 PENDING으로 남았다"는 것이라, 폴링이 그사이에 집어 가면
        // 이유 없이 깜빡인다. 이 컨텍스트에서만 폴링을 사실상 꺼 둔다.
        "outbox.relay.initial-delay-ms=3600000",
        "outbox.relay.fixed-delay-ms=3600000"})
class OutboxRelayWakeupFailureTest {

    private static final String DESTINATION = "test.relay.wakeup-broken";

    @Autowired private OutboxPublisher publisher;
    @Autowired private JdbcTemplate jdbc;

    @MockitoBean private RabbitTemplate rabbitTemplate;

    @MockitoBean(name = OutboxAsyncConfig.OUTBOX_RELAY_EXECUTOR)
    private AsyncTaskExecutor relayExecutor;

    @AfterEach
    void cleanUp() {
        jdbc.update("DELETE FROM core.outbox_events WHERE destination = ?", DESTINATION);
    }

    @Test
    void a_broken_wakeup_does_not_fail_the_business_transaction() {
        doThrow(new TaskRejectedException("실행기 종료 중")).when(relayExecutor).execute(any(Runnable.class));
        String key = UUID.randomUUID().toString();

        assertThatCode(() -> publisher.enqueue(DESTINATION, "material_asset", "broken-1",
                "TEST_WAKEUP_REQUESTED", "{}", key, null))
                .doesNotThrowAnyException();

        assertThat(statusOf(key))
                .as("깨우지 못했을 뿐 잡은 실렸다 — 폴링이 집어 간다")
                .isEqualTo("PENDING");
    }

    private String statusOf(String idempotencyKey) {
        return jdbc.queryForObject(
                "SELECT status FROM core.outbox_events WHERE idempotency_key = ?", String.class, idempotencyKey);
    }
}
