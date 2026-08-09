package com.liveclass.live.web.ws;

import com.liveclass.live.service.LiveAccessGuard;
import com.liveclass.live.service.LivePresenceRegistry;
import com.liveclass.live.service.LiveSessionForbiddenException;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;

import java.security.Principal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 용어집 토픽 구독 인가.
 *
 * <p>ADR-0019의 <b>와일드카드 차단 불변식</b>을 함께 지킨다 — 토픽을 하나 더할 때마다 "허용목록에
 * 정확 매칭만"이 무너지지 않았는지 확인하지 않으면, 임의 세션을 도청하는 구멍이 조용히 열린다.
 */
class GlossaryTopicSubscriptionTest {

    private final LiveAccessGuard accessGuard = mock(LiveAccessGuard.class);
    private final LivePresenceRegistry presenceRegistry = mock(LivePresenceRegistry.class);
    private final WsLivePresenceBroadcaster presenceBroadcaster = mock(WsLivePresenceBroadcaster.class);
    private final ChatTopicSubscriptionInterceptor interceptor =
            new ChatTopicSubscriptionInterceptor(accessGuard, presenceRegistry, presenceBroadcaster);
    private final MessageChannel channel = mock(MessageChannel.class);

    private static final UUID SESSION_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();

    private Message<byte[]> subscribeTo(String destination) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(StompCommand.SUBSCRIBE);
        accessor.setDestination(destination);
        accessor.setUser((Principal) USER_ID::toString);
        accessor.setSessionId("ws-connection-1");
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }

    @Test
    void 수강_관계가_있으면_용어집_토픽을_구독할_수_있다() {
        when(accessGuard.requireCanAccess(any(), any())).thenReturn(false);

        assertThatCode(() -> interceptor.preSend(
                subscribeTo("/topic/live-sessions/" + SESSION_ID + "/glossary"), channel))
                .doesNotThrowAnyException();
    }

    @Test
    void 용어집_토픽도_자막_채팅과_같은_게이트를_탄다() {
        // payload에 용어가 없어도 게이트는 똑같이 건다 — 어느 강의가 언제 용어를 갱신했는지도
        // 수강 관계가 있는 사람만 알 일이다.
        when(accessGuard.requireCanAccess(any(), any()))
                .thenThrow(new LiveSessionForbiddenException("접근 권한이 없습니다."));

        assertThatThrownBy(() -> interceptor.preSend(
                subscribeTo("/topic/live-sessions/" + SESSION_ID + "/glossary"), channel))
                .isInstanceOf(LiveSessionForbiddenException.class);
    }

    @Test
    void 와일드카드_구독은_여전히_막힌다() {
        // 토픽을 더해도 이 불변식은 유지돼야 한다(ADR-0019).
        assertThatThrownBy(() -> interceptor.preSend(subscribeTo("/topic/**"), channel))
                .isInstanceOf(LiveSessionForbiddenException.class);
        assertThatThrownBy(() -> interceptor.preSend(
                subscribeTo("/topic/live-sessions/" + SESSION_ID + "/glossary/**"), channel))
                .isInstanceOf(LiveSessionForbiddenException.class);
    }

    @Test
    void 비슷하지만_다른_이름은_통과시키지_않는다() {
        assertThatThrownBy(() -> interceptor.preSend(
                subscribeTo("/topic/live-sessions/" + SESSION_ID + "/glossaries"), channel))
                .isInstanceOf(LiveSessionForbiddenException.class);
    }

    @Test
    void 세션id가_UUID가_아니면_거부한다() {
        assertThatThrownBy(() -> interceptor.preSend(
                subscribeTo("/topic/live-sessions/not-a-uuid/glossary"), channel))
                .isInstanceOf(LiveSessionForbiddenException.class);
    }
}
