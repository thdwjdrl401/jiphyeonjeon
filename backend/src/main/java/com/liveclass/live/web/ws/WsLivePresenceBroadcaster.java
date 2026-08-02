package com.liveclass.live.web.ws;

import com.liveclass.live.service.LivePresenceRegistry;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 접속자 수를 세션 상태 토픽으로 전파한다.
 *
 * <p><b>새 토픽을 만들지 않는다.</b> 이미 있는 {@code /topic/live-sessions/{id}/state}에 실어 보낸다 —
 * 토픽을 늘리면 구독 인가 허용목록(ADR-0019의 와일드카드 차단 불변식)도 함께 늘어나고, 그만큼
 * 도청 구멍이 생길 자리가 늘어난다. 강의실은 이 토픽을 이미 구독하고 있다.
 *
 * <p><b>이 브로드캐스트는 이미 있던 사람들에게 알리는 용도다.</b> 방금 들어온 본인은 이걸 받지 못한다 —
 * 구독 인가는 브로커가 구독을 등록하기 <b>전에</b> 지나가므로, 그 시점에 보낸 메시지는 자기 구독에
 * 닿지 않는다. 그래서 본인의 초기값은 {@code GET /api/live-sessions/{id}}의 {@code participantCount}로
 * 준다(ADR-0060). WebSocket만으로 초기값까지 맞추려 하면 브로커 등록 시점에 기대는 경합이 된다.
 */
@Component
public class WsLivePresenceBroadcaster {

    static final String PRESENCE_EVENT_TYPE = "session.presence";

    /*
     * <b>지연 조회한다.</b> 이 빈은 구독 인터셉터가 부르는데, 인터셉터는 WebSocket 설정이 만들고
     * {@link SimpMessagingTemplate}도 그 설정이 만든다. 생성자에서 바로 받으면
     * 인터셉터 → 이 빈 → 템플릿 → WS 설정 → 인터셉터로 순환해 컨텍스트가 뜨지 않는다.
     */
    private final ObjectProvider<SimpMessagingTemplate> messagingTemplate;
    private final LivePresenceRegistry registry;

    public WsLivePresenceBroadcaster(ObjectProvider<SimpMessagingTemplate> messagingTemplate,
                                     LivePresenceRegistry registry) {
        this.messagingTemplate = messagingTemplate;
        this.registry = registry;
    }

    /** 구독 인가를 통과한 연결이 등록된 직후. 인터셉터가 부른다. */
    public void announce(UUID liveSessionId) {
        messagingTemplate.getObject().convertAndSend(
                "/topic/live-sessions/" + liveSessionId + "/state",
                WsEnvelope.of(PRESENCE_EVENT_TYPE, liveSessionId, OffsetDateTime.now(),
                        new LivePresencePayload(registry.audienceCount(liveSessionId))));
    }

    /**
     * 연결이 끊기면 그 사람을 빼고 남은 사람들에게 알린다.
     *
     * <p>브라우저를 닫든 네트워크가 끊기든 STOMP {@code DISCONNECT}가 오지 않을 수 있는데, 그때도
     * WebSocket 세션 종료로 이 이벤트는 발생한다 — 그래서 UNSUBSCRIBE가 아니라 여기에 건다.
     */
    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        registry.leave(event.getSessionId()).ifPresent(this::announce);
    }
}
