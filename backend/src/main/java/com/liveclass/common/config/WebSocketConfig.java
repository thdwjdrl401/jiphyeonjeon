package com.liveclass.common.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * 실시간 채팅 STOMP 브로커 (ADR-0019).
 *
 * <ul>
 *   <li>엔드포인트 {@code /api/ws} — 핸드셰이크가 시큐리티 필터를 타므로 쿠키 세션의 인증 주체(userId)가
 *       그대로 STOMP Principal이 된다. 별도 토큰이 필요 없다.</li>
 *   <li>구독은 {@code /topic/**}(SimpleBroker), 클라이언트 전송은 {@code /app/**}로 라우팅.</li>
 *   <li>개인 알림은 {@code /user/queue/notifications} — 목적지가 Principal로 해석되어 남의 것을
 *       구독할 수 없다.</li>
 *   <li>오리진 화이트리스트로 CSWSH를 막는다({@link WsProperties}).</li>
 * </ul>
 *
 * 단일 인스턴스 SimpleBroker다 — 다중 인스턴스로 확장하면 브로드캐스트가 인스턴스 경계를 못 넘으므로
 * 외부 브로커(Redis/RabbitMQ relay)로 교체해야 한다(후속).
 */
@Configuration
@EnableWebSocketMessageBroker
@EnableConfigurationProperties(WsProperties.class)
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final WsProperties properties;

    public WebSocketConfig(WsProperties properties) {
        this.properties = properties;
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/api/ws")
                .setAllowedOriginPatterns(properties.allowedOriginPatterns().toArray(new String[0]));
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        /*
         * /queue는 **개인 알림 전용**이다(ADR-0073 5단계). 토픽과 달리 Spring이 목적지를 세션의
         * Principal로 해석하므로(/user/queue/...), 남의 알림을 구독할 방법이 구조적으로 없다 —
         * 구독 인가 목록에 줄을 더할 필요도 없다.
         */
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");
    }
}
