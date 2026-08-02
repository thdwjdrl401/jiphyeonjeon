package com.liveclass.live.web.ws;

import com.liveclass.live.service.LiveAccessGuard;
import com.liveclass.live.service.LivePresenceRegistry;
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
 * STOMP 라이브 토픽 구독 인가. {@code /topic/live-sessions/{sessionId}/chat}·
 * {@code /topic/live-sessions/{sessionId}/captions}·{@code /topic/live-sessions/{sessionId}/state}
 * 구독 요청을 REST 조회·전송과 동일한 게이트
 * (소유 강사 또는 활성 수강생)로 검증한다 — 없으면 구독을 거부한다.
 *
 * <p>이게 없으면 핸드셰이크만 통과한 아무 사용자나 임의 세션 토픽을 구독해 실시간 채팅·자막을 수신할 수 있다
 * (전송·발행은 서버에서 이미 게이팅되지만 수신-구독은 브로커 직행이라 별도 차단이 필요하다).
 * 인증(쿠키 세션 → Principal=userId)은 핸드셰이크에서 이미 끝나 있다.
 *
 * <p><b>와일드카드 차단 불변식(ADR-0019)</b>: SimpleBroker는 구독 destination을 패턴(AntPathMatcher)으로
 * 매칭하므로 {@code /topic/**} 같은 와일드카드 구독이 게이트를 우회할 수 있다. 명시적으로 허용한 세 토픽
 * (chat·captions·state·notes)의 <b>정확 매칭</b>만 통과시키고 그 외 {@code /topic} 구독은 전부 거부한다 — 토픽을
 * 추가해도 이 불변식은 유지된다(임의 세션 자막 도청 구멍 금지).
 */
@Component
public class ChatTopicSubscriptionInterceptor implements ChannelInterceptor {

    private static final Pattern CHAT_TOPIC =
            Pattern.compile("^/topic/live-sessions/([^/]+)/chat$");
    private static final Pattern CAPTIONS_TOPIC =
            Pattern.compile("^/topic/live-sessions/([^/]+)/captions$");
    private static final Pattern STATE_TOPIC =
            Pattern.compile("^/topic/live-sessions/([^/]+)/state$");
    /** 강의 노트(CONTRACT §3-4a). 자막·채팅과 같은 게이트를 쓴다. */
    private static final Pattern NOTES_TOPIC =
            Pattern.compile("^/topic/live-sessions/([^/]+)/notes$");

    private final LiveAccessGuard accessGuard;
    private final LivePresenceRegistry presenceRegistry;
    private final WsLivePresenceBroadcaster presenceBroadcaster;

    public ChatTopicSubscriptionInterceptor(LiveAccessGuard accessGuard,
                                            LivePresenceRegistry presenceRegistry,
                                            WsLivePresenceBroadcaster presenceBroadcaster) {
        this.accessGuard = accessGuard;
        this.presenceRegistry = presenceRegistry;
        this.presenceBroadcaster = presenceBroadcaster;
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
        // 명시적으로 허용한 토픽(chat·captions)의 정확 매칭만 통과. 와일드카드 포함 그 외는 전부 거부.
        Matcher matcher = CHAT_TOPIC.matcher(destination);
        if (!matcher.matches()) {
            matcher = CAPTIONS_TOPIC.matcher(destination);
        }
        if (!matcher.matches()) {
            matcher = STATE_TOPIC.matcher(destination);
        }
        if (!matcher.matches()) {
            matcher = NOTES_TOPIC.matcher(destination);
        }
        if (!matcher.matches()) {
            throw new LiveSessionForbiddenException("허용되지 않은 구독 대상입니다.");
        }
        Principal principal = accessor.getUser();
        if (principal == null) {
            throw new LiveSessionForbiddenException("인증되지 않은 구독입니다.");
        }
        UUID sessionId;
        try {
            sessionId = UUID.fromString(matcher.group(1));
        } catch (IllegalArgumentException malformed) {
            throw new LiveSessionForbiddenException("잘못된 구독 대상입니다.");
        }
        // 소유 강사이거나 활성 수강생만. 아니면 예외 → 구독 프레임이 브로커에 도달하지 못하고 거부된다.
        UUID userId = UUID.fromString(principal.getName());
        boolean instructor = accessGuard.requireCanAccess(sessionId, userId);

        /*
         * 인가를 통과한 뒤에만 접속자로 센다. 거부된 구독은 예외로 위에서 끝나므로 여기 오지 않는다.
         *
         * <p>연결 하나가 토픽을 여러 개(chat·captions·state) 구독하므로 처음 한 번만 등록되고, 그때만
         * 알린다 — 구독마다 알리면 접속 한 번에 브로드캐스트가 세 번 나간다.
         */
        String connectionId = accessor.getSessionId();
        if (connectionId != null && presenceRegistry.join(connectionId, sessionId, userId, instructor)) {
            presenceBroadcaster.announce(sessionId);
        }
        return message;
    }
}
