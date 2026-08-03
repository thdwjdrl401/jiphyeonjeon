package com.liveclass.notification.config;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.boot.amqp.autoconfigure.SimpleRabbitListenerContainerFactoryConfigurer;
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
@Configuration
public class NotificationMessagingConfig {

    public static final String FANOUT_QUEUE = "notification.fanout";
    public static final String FANOUT_DLQ = "notification.fanout.dlq";

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
            SimpleRabbitListenerContainerFactoryConfigurer configurer) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        configurer.configure(factory, connectionFactory);
        factory.setDefaultRequeueRejected(false);
        return factory;
    }
}
