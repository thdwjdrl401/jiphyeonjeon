package com.liveclass.live.web.ws;

import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * 채팅 WS 인가 배선(live 모듈 소유). 브로커 설정·엔드포인트는 common의 WebSocketConfig가 담당하고,
 * 여기선 채팅 도메인 규칙(구독 인가)만 인바운드 채널에 얹는다 — common→live 역의존을 만들지 않도록
 * 별도 configurer로 분리한다. Spring이 모든 WebSocketMessageBrokerConfigurer를 수집·적용한다.
 */
@Configuration
public class ChatWsSecurityConfig implements WebSocketMessageBrokerConfigurer {

    private final ChatTopicSubscriptionInterceptor chatSubscriptionInterceptor;

    public ChatWsSecurityConfig(ChatTopicSubscriptionInterceptor chatSubscriptionInterceptor) {
        this.chatSubscriptionInterceptor = chatSubscriptionInterceptor;
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(chatSubscriptionInterceptor);
    }
}
