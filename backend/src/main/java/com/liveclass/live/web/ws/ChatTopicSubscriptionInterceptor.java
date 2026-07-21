package com.liveclass.live.web.ws;

import com.liveclass.live.service.LiveAccessGuard;
import com.liveclass.live.service.LiveSessionForbiddenException;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.stereotype.Component;

import java.security.Principal;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * STOMP 채팅 토픽 구독 인가. {@code /topic/live-sessions/{sessionId}/chat} 구독 요청을
 * REST 조회·전송과 동일한 게이트(소유 강사 또는 활성 수강생)로 검증한다 — 없으면 구독을 거부한다.
 *
 * <p>이게 없으면 핸드셰이크만 통과한 아무 사용자나 임의 세션 토픽을 구독해 실시간 채팅을 수신할 수 있다
 * (전송은 컨트롤러에서 이미 게이팅되지만 수신-구독은 브로커 직행이라 별도 차단이 필요하다).
 * 인증(쿠키 세션 → Principal=userId)은 핸드셰이크에서 이미 끝나 있다.
 */
@Component
public class ChatTopicSubscriptionInterceptor implements ChannelInterceptor {

    private static final Pattern CHAT_TOPIC =
            Pattern.compile("^/topic/live-sessions/([^/]+)/chat$");

    private final LiveAccessGuard accessGuard;

    public ChatTopicSubscriptionInterceptor(LiveAccessGuard accessGuard) {
        this.accessGuard = accessGuard;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(message);
        if (!StompCommand.SUBSCRIBE.equals(accessor.getCommand())) {
            return message;   // SUBSCRIBE만 검사한다.
        }
        String destination = accessor.getDestination();
        if (destination == null || !destination.startsWith("/topic")) {
            return message;   // 브로커 토픽 구독만 통제한다(그 외 destination은 대상 아님).
        }
        // SimpleBroker는 구독 destination을 패턴(AntPathMatcher)으로 매칭한다 — `/topic/**` 같은
        // 와일드카드 구독이 채팅 브로드캐스트를 받아 게이트를 우회할 수 있다. 이 앱의 유일한 토픽은
        // 채팅이므로, 구체적 채팅 토픽이 아니면(와일드카드 포함) 전부 거부해 우회를 막는다.
        Matcher matcher = CHAT_TOPIC.matcher(destination);
        if (!matcher.matches()) {
            throw new LiveSessionForbiddenException("허용되지 않은 구독 대상입니다.");
        }
        Principal principal = accessor.getUser();
        if (principal == null) {
            throw new LiveSessionForbiddenException("인증되지 않은 채팅 구독입니다.");
        }
        UUID sessionId;
        try {
            sessionId = UUID.fromString(matcher.group(1));
        } catch (IllegalArgumentException malformed) {
            throw new LiveSessionForbiddenException("잘못된 채팅 구독 대상입니다.");
        }
        // 소유 강사이거나 활성 수강생만. 아니면 예외 → 구독 프레임이 브로커에 도달하지 못하고 거부된다.
        accessGuard.requireCanAccess(sessionId, UUID.fromString(principal.getName()));
        return message;
    }
}
