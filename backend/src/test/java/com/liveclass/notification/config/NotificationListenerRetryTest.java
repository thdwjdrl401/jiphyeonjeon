package com.liveclass.notification.config;

import org.aopalliance.aop.Advice;
import org.aopalliance.intercept.MethodInterceptor;
import org.aopalliance.intercept.MethodInvocation;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.listener.ListenerExecutionFailedException;
import org.springframework.boot.amqp.autoconfigure.RabbitProperties;
import org.springframework.boot.amqp.autoconfigure.SimpleRabbitListenerContainerFactoryConfigurer;
import org.springframework.dao.TransientDataAccessResourceException;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.core.JsonParser;
import tools.jackson.core.exc.StreamReadException;

import java.lang.reflect.AccessibleObject;
import java.lang.reflect.Method;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

/**
 * 알림 리스너의 재시도가 <b>실제로 도는지</b>(ADR-0133).
 *
 * <p>이 테스트가 있는 이유는 없던 시절의 상태 때문이다. 팩토리 javadoc에는 "재시도 3회 뒤 포기하고
 * DLQ로"라고 적혀 있었지만 재시도를 붙이는 곳은 전역
 * {@code spring.rabbitmq.listener.simple.retry.*}뿐이었고, {@code application.yml}에 그 블록이 없어
 * Boot 기본값 {@code retry.enabled=false}가 살아 있었다 — 첫 실패가 곧 DLQ였다. 문서만 고치면
 * 같은 어긋남이 다시 생기므로 동작을 검사로 고정한다.
 *
 * <p><b>브로커를 띄우지 않는다.</b> 확인할 것은 RabbitMQ의 동작이 아니라 어드바이스의 판단
 * — 몇 번 다시 부르는가, 언제 그만두는가, 그만둘 때 무엇을 던지는가 — 이고 그 셋은 인터셉터를
 * 직접 불러 볼 수 있다. 컨테이너는 이 어드바이스를
 * {@code ContainerDelegate.invokeListener(Channel, Object)}에 걸므로 인수는 {@code [채널, 메시지]}다.
 */
class NotificationListenerRetryTest {

    private static final Message MESSAGE = new Message("{\"type\":\"X\"}".getBytes());

    /** 리스너 어댑터가 실제로 하는 일 — 핸들러 예외를 이것으로 감싼다. 분류기는 사슬을 훑어야 한다. */
    private static Throwable wrapped(Throwable cause) {
        return new ListenerExecutionFailedException("Listener method threw exception", cause, MESSAGE);
    }

    /** 정해진 횟수만큼 실패한 뒤 성공하는 리스너 호출. 호출 수를 센다. */
    private static final class Invocation implements MethodInvocation {

        private final AtomicInteger calls = new AtomicInteger();
        private final int failuresBeforeSuccess;
        private final Throwable failure;

        Invocation(int failuresBeforeSuccess, Throwable failure) {
            this.failuresBeforeSuccess = failuresBeforeSuccess;
            this.failure = failure;
        }

        @Override
        public Object proceed() throws Throwable {
            if (calls.incrementAndGet() <= this.failuresBeforeSuccess) {
                throw this.failure;
            }
            return null;
        }

        @Override
        public Object[] getArguments() {
            return new Object[] {null, MESSAGE};
        }

        @Override
        public Method getMethod() {
            try {
                return Object.class.getMethod("toString");
            }
            catch (NoSuchMethodException ex) {
                throw new IllegalStateException(ex);
            }
        }

        @Override
        public Object getThis() {
            return this;
        }

        @Override
        public AccessibleObject getStaticPart() {
            return getMethod();
        }
    }

    private static Invocation alwaysFailingWith(Throwable failure) {
        return new Invocation(Integer.MAX_VALUE, failure);
    }

    /** 백오프가 테스트 시간을 지배하지 않게 1ms로 둔다. 대기 자체는 아래 별도 테스트가 본다. */
    private static MethodInterceptor advice(int maxRetries) {
        return (MethodInterceptor) NotificationMessagingConfig.listenerRetryAdvice(maxRetries, 1, 1.0, 1);
    }

    @Test
    @DisplayName("일시적 실패는 설정한 횟수만큼 다시 시도한다")
    void transient_failure_is_retried() throws Throwable {
        Invocation invocation = alwaysFailingWith(
                wrapped(new TransientDataAccessResourceException("커넥션 풀이 잠깐 비었다")));

        assertThatThrownBy(() -> advice(3).invoke(invocation))
                .isInstanceOf(ListenerExecutionFailedException.class);

        // 첫 시도 1회 + 재시도 3회.
        assertThat(invocation.calls).hasValue(4);
    }

    @Test
    @DisplayName("재시도가 소진되면 requeue 없는 reject를 던진다 — 메시지가 조용히 ack되면 안 된다")
    void exhausted_retries_reject_without_requeue() {
        Invocation invocation = alwaysFailingWith(wrapped(new TransientDataAccessResourceException("계속 막힌다")));

        /*
         * recoverer를 주지 않으면 StatelessRetryOperationsInterceptorFactoryBean이 WARN 한 줄을 찍고
         * null을 반환한다. 컨테이너가 보기엔 정상 종료라 메시지가 ack되고 사라진다 — DLQ로 가지
         * 않는다. 그래서 "던진다"가 이 테스트의 요지다.
         */
        assertThatThrownBy(() -> advice(2).invoke(invocation))
                .isInstanceOf(ListenerExecutionFailedException.class)
                .hasCauseInstanceOf(AmqpRejectAndDontRequeueException.class);
    }

    @Test
    @DisplayName("중간에 성공하면 거기서 멈춘다")
    void success_stops_the_retries() throws Throwable {
        Invocation invocation = new Invocation(1, wrapped(new TransientDataAccessResourceException("한 번만 막혔다")));

        assertThat(advice(3).invoke(invocation)).isNull();
        assertThat(invocation.calls).hasValue(2);
    }

    /**
     * 결정론적 실패는 재시도하지 않는다.
     *
     * <p>{@code NotificationFanoutWorker.handle}은 계약에 없는 알림 종류에
     * {@link IllegalArgumentException}을 던진다. 종류 판정은 코드 안의 표만 보므로 1초 뒤에도 같은
     * 답이 나오고, 다시 부르는 동안 소비자만 묶인다.
     */
    @Test
    @DisplayName("알 수 없는 알림 종류는 재시도 없이 곧바로 DLQ로 간다")
    void unknown_notification_type_is_not_retried() {
        Invocation invocation = alwaysFailingWith(
                wrapped(new IllegalArgumentException("알 수 없는 알림 종류입니다: NOPE")));

        assertThatThrownBy(() -> advice(3).invoke(invocation))
                .isInstanceOf(ListenerExecutionFailedException.class)
                .hasCauseInstanceOf(AmqpRejectAndDontRequeueException.class);

        assertThat(invocation.calls).as("첫 시도 한 번뿐").hasValue(1);
    }

    @Test
    @DisplayName("파싱되지 않는 페이로드는 재시도 없이 곧바로 DLQ로 간다")
    void unparseable_payload_is_not_retried() {
        Invocation invocation = alwaysFailingWith(
                wrapped(new StreamReadException((JsonParser) null, "깨진 JSON")));

        assertThatThrownBy(() -> advice(3).invoke(invocation))
                .isInstanceOf(ListenerExecutionFailedException.class);

        assertThat(invocation.calls).hasValue(1);
    }

    @Test
    @DisplayName("AmqpRejectAndDontRequeueException은 그 뜻대로 재시도되지 않는다")
    void explicit_dont_requeue_signal_is_not_retried() {
        Invocation invocation = alwaysFailingWith(wrapped(new AmqpRejectAndDontRequeueException("버려라")));

        assertThatThrownBy(() -> advice(3).invoke(invocation))
                .isInstanceOf(ListenerExecutionFailedException.class);

        assertThat(invocation.calls).hasValue(1);
    }

    @Test
    @DisplayName("백오프가 지수로 늘고 상한에서 멈춘다")
    void backoff_grows_and_is_capped() {
        // 100ms에서 시작해 배수 2.0, 상한 150ms → 100 + 150 + 150 = 최소 400ms.
        MethodInterceptor interceptor =
                (MethodInterceptor) NotificationMessagingConfig.listenerRetryAdvice(3, 100, 2.0, 150);
        Invocation invocation = alwaysFailingWith(wrapped(new TransientDataAccessResourceException("계속 막힌다")));

        long startedAt = System.nanoTime();
        assertThatThrownBy(() -> interceptor.invoke(invocation)).isInstanceOf(Throwable.class);
        long elapsedMs = (System.nanoTime() - startedAt) / 1_000_000;

        // 아래로만 본다. 위를 재면 CI 스케줄러 지연으로 흔들린다.
        assertThat(elapsedMs).isGreaterThanOrEqualTo(400L);
        assertThat(invocation.calls).hasValue(4);
    }

    /**
     * 어드바이스가 <b>두 팩토리에 실제로 걸려 있는지</b>. 위 테스트들이 다 통과해도 이게 없으면
     * 리스너는 그대로 재시도 없이 돈다 — 고치려던 어긋남이 정확히 그 모양이었다.
     *
     * <p>configurer는 진짜를 쓴다. Boot 기본값에는 {@code retry.enabled=false}가 들어 있어
     * configurer 혼자서는 어드바이스를 걸지 않으므로, 체인이 있다는 것은 우리가 건 것이라는 뜻이다.
     */
    @Test
    @DisplayName("두 리스너 팩토리에 재시도 어드바이스와 requeue 금지가 함께 걸려 있다")
    void both_factories_carry_the_advice() {
        NotificationMessagingConfig config = new NotificationMessagingConfig();
        ConnectionFactory connectionFactory = mock(ConnectionFactory.class);
        SimpleRabbitListenerContainerFactoryConfigurer configurer =
                new SimpleRabbitListenerContainerFactoryConfigurer(new RabbitProperties());

        SimpleRabbitListenerContainerFactory fanout = config.notificationListenerContainerFactory(
                connectionFactory, configurer, 8, 3, 500, 2.0, 5000);
        SimpleRabbitListenerContainerFactory push = config.notificationPushListenerContainerFactory(
                connectionFactory, configurer, 2, 3, 500, 2.0, 5000);

        for (SimpleRabbitListenerContainerFactory factory : new SimpleRabbitListenerContainerFactory[] {fanout, push}) {
            Advice[] chain = factory.getAdviceChain();
            assertThat(chain).as("재시도 어드바이스").hasSize(1);
            /*
             * 재시도가 소진된 뒤 DLQ로 가는 경로가 이 값에 걸려 있다. true면 reject된 메시지가 큐
             * 앞으로 돌아가 dead-letter 설정을 타지 않는다.
             */
            assertThat(ReflectionTestUtils.getField(factory, "defaultRequeueRejected"))
                    .as("requeue 금지").isEqualTo(Boolean.FALSE);
        }
    }
}
