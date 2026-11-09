package com.liveclass.notification.config;

import org.aopalliance.aop.Advice;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.rabbit.config.RetryInterceptorBuilder;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.retry.RejectAndDontRequeueRecoverer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.amqp.autoconfigure.SimpleRabbitListenerContainerFactoryConfigurer;
import com.liveclass.notification.push.WebPushProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.core.JacksonException;

import java.time.Duration;
import java.util.List;

/**
 * 알림 팬아웃 큐(ADR-0073). 아웃박스 릴레이가 이 이름을 라우팅 키로 써서 메시지를 넣고,
 * {@code NotificationFanoutWorker}가 꺼내 실제 알림 행을 만든다.
 *
 * <p><b>왜 큐를 거치는가.</b> 업무 트랜잭션에서 하는 일은 아웃박스에 한 줄 넣는 것뿐이고, 터질 수
 * 있는 일(문구 만들기·수신자 조회·대량 삽입)은 전부 여기 건너편에서 한다. 알림 코드의 버그가
 * 수강 승인을 롤백시키면 안 된다.
 */
/*
 * VAPID 설정도 여기서 묶는다. 애플리케이션 클래스에 @EnableConfigurationProperties를 달면 루트가
 * 알림 모듈 <b>내부</b> 타입을 참조하게 되어 모듈 경계 검사가 막는다 — 설정은 그 설정을 쓰는
 * 모듈이 등록한다.
 */
@EnableConfigurationProperties(WebPushProperties.class)
@Configuration
public class NotificationMessagingConfig {

    public static final String FANOUT_QUEUE = "notification.fanout";
    public static final String FANOUT_DLQ = "notification.fanout.dlq";

    /**
     * 푸시 전달 명령 큐(ADR-0124). 팬아웃 워커가 알림 행과 <b>같은 트랜잭션</b>에서 아웃박스에
     * 실은 명령이 릴레이를 거쳐 여기로 오고, {@code PushDeliveryWorker}가 꺼내 실제 발송을 한다.
     *
     * <p><b>팬아웃 큐와 분리한 이유가 이 설계의 전부다.</b> 푸시는 조각당 최대 60초짜리 HTTP
     * 대량 발송이라, 팬아웃 소비자가 이 일을 함께 하면 삽입 처리량이 푸시 속도에 묶인다.
     * 소비자·동시성을 따로 두면 팬아웃은 삽입 속도로 풀리고, 푸시는 자기 속도로 뒤따라온다.
     */
    public static final String PUSH_QUEUE = "notification.push";
    public static final String PUSH_DLQ = "notification.push.dlq";

    /**
     * 실패한 메시지가 갈 곳. <b>이게 없으면 안 된다</b> — 기본 동작은 실패 시 큐에 되돌리는 것이라,
     * 절대 성공하지 못하는 메시지 하나가 무한히 재배달되며 워커를 붙잡는다(poison message).
     */
    @Bean
    Queue notificationFanoutDlq() {
        return QueueBuilder.durable(FANOUT_DLQ).build();
    }

    @Bean
    Queue notificationFanoutQueue() {
        return QueueBuilder.durable(FANOUT_QUEUE)
                // 기본 익스체인지("")로 DLQ 이름에 그대로 라우팅한다.
                .deadLetterExchange("")
                .deadLetterRoutingKey(FANOUT_DLQ)
                .build();
    }

    /**
     * 알림 전용 리스너 팩토리.
     *
     * <p>전역 설정을 건드리지 않고 <b>이 리스너에만</b> 규칙을 준다 — 재시도 뒤 포기하고 DLQ로.
     * 횟수·백오프는 {@code notification.fanout.listener-max-retries}와 그 아래
     * {@code listener-retry-*}가 정하고, 판단 근거는 {@link #listenerRetryAdvice}에 있다.
     * {@code defaultRequeueRejected=false}가 그 DLQ 경로를 만든다. 기본값(true)이면 실패한 메시지가
     * 큐 앞으로 돌아가 곧바로 다시 배달되고, 원인이 사라지지 않는 한 그 자리를 영원히 돈다.
     *
     * <p>재시도가 있는 이유는 실패가 두 종류이기 때문이다 — DB 순간 장애처럼 곧 나아지는 것과
     * 페이로드가 깨진 것처럼 몇 번을 해도 같은 것. 앞엣것은 다시 해 보고, 뒤엣것은 곧바로 포기한다
     * (ADR-0133).
     *
     * <p><b>전에는 이 문단이 사실이 아니었다.</b> "재시도 3회"라고 적혀 있었지만 재시도를 붙이는
     * 곳은 전역 {@code spring.rabbitmq.listener.simple.retry.*}뿐이고 그 블록이 없어
     * Boot 기본값 {@code retry.enabled=false}가 그대로 살아 있었다 — 첫 실패가 곧 DLQ였다.
     */
    @Bean
    SimpleRabbitListenerContainerFactory notificationListenerContainerFactory(
            ConnectionFactory connectionFactory,
            SimpleRabbitListenerContainerFactoryConfigurer configurer,
            @Value("${notification.fanout.listener-concurrency:8}") int concurrency,
            @Value("${notification.fanout.listener-max-retries:3}") int maxRetries,
            @Value("${notification.fanout.listener-retry-initial-backoff-ms:500}") long initialBackoffMs,
            @Value("${notification.fanout.listener-retry-multiplier:2.0}") double multiplier,
            @Value("${notification.fanout.listener-retry-max-backoff-ms:5000}") long maxBackoffMs) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        configurer.configure(factory, connectionFactory);
        factory.setDefaultRequeueRejected(false);
        /*
         * 소비자 수를 <b>자기 설정으로</b> 정한다(ADR-0131). 전에는 전역
         * {@code spring.rabbitmq.listener.simple.concurrency}를 그대로 물려받았는데, 그러면 팬아웃을
         * 늘리려고 전역을 올리게 되고 전역은 이름상 팬아웃 것이 아니다. 푸시가 이미 같은 이유로
         * 자기 값을 갖는다.
         */
        factory.setConcurrentConsumers(concurrency);
        // 재시도도 같은 원칙이다 — 전역 retry 스위치를 켜면 아웃박스 릴레이를 비롯한 다른 리스너까지
        // 함께 바뀐다. configurer가 이미 부어 놓은 것이 있으면 덮어쓰도록 **뒤에** 건다.
        factory.setAdviceChain(listenerRetryAdvice(maxRetries, initialBackoffMs, multiplier, maxBackoffMs));
        return factory;
    }

    // ---- 푸시 전달 큐(ADR-0124) ----

    /** 푸시 명령의 DLQ. 팬아웃 DLQ와 같은 이유로 있어야 한다 — poison message가 소비자를 붙잡는다. */
    @Bean
    Queue notificationPushDlq() {
        return QueueBuilder.durable(PUSH_DLQ).build();
    }

    @Bean
    Queue notificationPushQueue() {
        return QueueBuilder.durable(PUSH_QUEUE)
                .deadLetterExchange("")
                .deadLetterRoutingKey(PUSH_DLQ)
                .build();
    }

    /**
     * 푸시 전용 리스너 팩토리. 실패 규칙은 팬아웃과 같다(재시도 뒤 DLQ, requeue 금지).
     *
     * <p>따로 두는 이유는 규칙이 아니라 <b>동시성</b>이다 — 전역 {@code concurrency}(팬아웃 워커
     * 수)를 그대로 물려받으면 두 큐가 같은 설정에 묶여, 푸시를 늘리려다 팬아웃까지 늘리게 된다.
     * 푸시 소비자 수는 {@code notification.push.listener-concurrency}가 따로 정한다.
     *
     * <p>재시도 설정도 {@code notification.push.listener-retry-*}로 따로 둔다. 값은 팬아웃과 같지만
     * 조각당 최대 {@code batch-timeout-ms}(60초)를 붙잡는 소비자라 한 번의 재시도가 큐에 미치는
     * 영향이 다르고, 한쪽만 조정할 수 있어야 한다.
     *
     * <p><b>이 큐의 기기 단위 재시도와는 다른 층이다.</b> {@code notification.push.max-delivery-attempts}는
     * 푸시 서비스가 429·5xx로 막은 <b>사람</b>만 골라 새 명령으로 다시 싣는 것이고(ADR-0128),
     * 여기 재시도는 소비 자체가 예외로 끝났을 때 <b>같은 메시지</b>를 다시 처리하는 것이다.
     */
    @Bean
    SimpleRabbitListenerContainerFactory notificationPushListenerContainerFactory(
            ConnectionFactory connectionFactory,
            SimpleRabbitListenerContainerFactoryConfigurer configurer,
            @Value("${notification.push.listener-concurrency:2}") int concurrency,
            @Value("${notification.push.listener-prefetch:1}") int prefetch,
            @Value("${notification.push.listener-max-retries:3}") int maxRetries,
            @Value("${notification.push.listener-retry-initial-backoff-ms:500}") long initialBackoffMs,
            @Value("${notification.push.listener-retry-multiplier:2.0}") double multiplier,
            @Value("${notification.push.listener-retry-max-backoff-ms:5000}") long maxBackoffMs) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        configurer.configure(factory, connectionFactory);
        factory.setDefaultRequeueRejected(false);
        // configurer가 전역 설정(팬아웃 워커 수)을 이미 부어 놓았으므로 **뒤에** 덮어쓴다.
        factory.setConcurrentConsumers(concurrency);
        /*
         * **미리 쥐는 수를 1로 둔다.** 전역 기본값은 250인데, 넓은 팬아웃 한 번이 만드는 푸시 명령은
         * 조각 수만큼(수신자 100만·조각 5,000이면 201건)뿐이다. 250이면 먼저 붙은 소비자가 201건을
         * 통째로 가져가고 같은 프로세스의 다른 소비자도, 다른 발송 노드도 빈손으로 논다 —
         * 노드를 늘려도 처리량이 안 늘어난다는 뜻이다(ADR-0136).
         *
         * 명령 하나가 수천 건 발송이라 수 초씩 걸리므로 미리 쥘 이유도 없다. 쥐는 순간부터
         * 그 메시지는 다른 소비자에게 못 간다.
         */
        factory.setPrefetchCount(prefetch);
        factory.setAdviceChain(listenerRetryAdvice(maxRetries, initialBackoffMs, multiplier, maxBackoffMs));
        return factory;
    }

    /**
     * 다시 해 봐야 결과가 같은 실패들. 이 셋 중 하나가 <b>원인 사슬 어딘가에</b> 있으면 재시도 없이
     * 곧바로 DLQ로 보낸다.
     *
     * <ul>
     *   <li>{@link IllegalArgumentException} — {@code NotificationFanoutWorker.handle}이 계약에 없는
     *       알림 종류에 던진다. 종류 판정은 코드 안의 표만 보므로 1초 뒤에도 같은 답이 나온다.</li>
     *   <li>{@link JacksonException} — 페이로드가 명령 타입으로 파싱되지 않는다. 바이트가 바뀌지 않는
     *       한 다음 시도도 같은 자리에서 실패한다.</li>
     *   <li>{@link AmqpRejectAndDontRequeueException} — AMQP에서 "재시도 말고 버려라"의 표준 신호다.
     *       재시도 계층이 이걸 못 알아보면 그 뜻이 사라진다.</li>
     * </ul>
     *
     * <p><b>원인 사슬을 훑어야 한다.</b> {@code @RabbitListener} 메서드에서 나온 예외는 리스너 어댑터가
     * {@code ListenerExecutionFailedException}으로 감싸므로, 맨 바깥 타입만 보면 위 셋 중 무엇도
     * 걸리지 않는다. {@code RetryPolicy.Builder.excludes}는 {@code ExceptionTypeFilter}로 사슬을
     * 따라가며 맞춰 본다.
     */
    private static final List<Class<? extends Throwable>> NON_RETRYABLE = List.of(
            IllegalArgumentException.class,
            JacksonException.class,
            AmqpRejectAndDontRequeueException.class);

    /**
     * 두 리스너가 공유하는 재시도 어드바이스. 패키지 밖으로 열지 않되 테스트가 같은 경로로 만들 수
     * 있게 {@code static}으로 둔다.
     *
     * <p><b>왜 워커에서 {@code AmqpRejectAndDontRequeueException}으로 감싸지 않는가.</b> 그러면 큐
     * 계층의 사정이 업무 코드로 올라온다 — 팬아웃 워커는 "알 수 없는 종류다"만 말하면 되고, 그것을
     * 재시도할 것인지는 이 큐가 정할 일이다. 예외 분류기({@link #NON_RETRYABLE})로 가르면 워커를
     * 건드리지 않고, 두 워커에 같은 규칙이 한 곳에서 적용된다.
     *
     * <p><b>recoverer를 반드시 준다.</b> 없으면 {@code StatelessRetryOperationsInterceptorFactoryBean}이
     * WARN 한 줄을 찍고 {@code null}을 반환한다 — 컨테이너가 보기엔 정상 종료라 메시지가 ack되고
     * <b>사라진다</b>. {@link RejectAndDontRequeueRecoverer}는 대신
     * {@code AmqpRejectAndDontRequeueException}을 던져 requeue 없는 reject를 만들고, 그 reject가
     * 큐에 걸린 dead-letter 설정을 타고 DLQ로 간다. {@code defaultRequeueRejected=false}가 필요한
     * 이유도 여기다.
     *
     * <p><b>상태 없는(stateless) 재시도다.</b> 브로커에 되돌리지 않고 소비자 스레드 안에서 다시
     * 부른다. 백오프 동안 그 소비자가 묶이므로(기본값이면 최대 0.5+1+2 = 3.5초) 횟수를 크게 둘
     * 이유가 없다. 상태 있는(stateful) 쪽은 메시지 id로 재배달을 세는 방식인데, 이 큐의 메시지에는
     * 안정적인 message-id가 없어 쓸 수 없다.
     */
    static Advice listenerRetryAdvice(int maxRetries, long initialBackoffMs, double multiplier, long maxBackoffMs) {
        return RetryInterceptorBuilder.stateless()
                .configureRetryPolicy(policy -> policy
                        .maxRetries(maxRetries)
                        .delay(Duration.ofMillis(initialBackoffMs))
                        .multiplier(multiplier)
                        .maxDelay(Duration.ofMillis(maxBackoffMs))
                        .excludes(NON_RETRYABLE))
                .recoverer(new RejectAndDontRequeueRecoverer())
                .build();
    }
}
