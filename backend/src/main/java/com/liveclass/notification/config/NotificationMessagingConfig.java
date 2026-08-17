package com.liveclass.notification.config;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.amqp.autoconfigure.SimpleRabbitListenerContainerFactoryConfigurer;
import com.liveclass.notification.push.WebPushProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

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
     * <p>전역 설정을 건드리지 않고 <b>이 리스너에만</b> 규칙을 준다 — 재시도 3회 뒤 포기하고 DLQ로.
     * {@code defaultRequeueRejected=false}가 핵심이다. 기본값(true)이면 실패한 메시지가 큐 앞으로
     * 돌아가 곧바로 다시 배달되고, 원인이 사라지지 않는 한 그 자리를 영원히 돈다.
     *
     * <p>재시도가 있는 이유는 실패가 두 종류이기 때문이다 — DB 순간 장애처럼 곧 나아지는 것과
     * 페이로드가 깨진 것처럼 몇 번을 해도 같은 것. 앞엣것을 위해 세 번 해 보고, 뒤엣것을 위해 포기한다.
     */
    @Bean
    SimpleRabbitListenerContainerFactory notificationListenerContainerFactory(
            ConnectionFactory connectionFactory,
            SimpleRabbitListenerContainerFactoryConfigurer configurer,
            @Value("${notification.fanout.listener-concurrency:8}") int concurrency) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        configurer.configure(factory, connectionFactory);
        factory.setDefaultRequeueRejected(false);
        /*
         * 소비자 수를 <b>자기 손잡이로</b> 정한다(ADR-0131). 전에는 전역
         * {@code spring.rabbitmq.listener.simple.concurrency}를 그대로 물려받았는데, 그러면 팬아웃을
         * 늘리려고 전역을 올리게 되고 전역은 이름상 팬아웃 것이 아니다. 푸시가 이미 같은 이유로
         * 자기 값을 갖는다.
         */
        factory.setConcurrentConsumers(concurrency);
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
     * 수)를 그대로 물려받으면 두 큐가 같은 손잡이에 묶여, 푸시를 늘리려다 팬아웃까지 늘리게 된다.
     * 푸시 소비자 수는 {@code notification.push.listener-concurrency}가 따로 정한다.
     */
    @Bean
    SimpleRabbitListenerContainerFactory notificationPushListenerContainerFactory(
            ConnectionFactory connectionFactory,
            SimpleRabbitListenerContainerFactoryConfigurer configurer,
            @Value("${notification.push.listener-concurrency:2}") int concurrency) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        configurer.configure(factory, connectionFactory);
        factory.setDefaultRequeueRejected(false);
        // configurer가 전역 설정(팬아웃 워커 수)을 이미 부어 놓았으므로 **뒤에** 덮어쓴다.
        factory.setConcurrentConsumers(concurrency);
        return factory;
    }
}
