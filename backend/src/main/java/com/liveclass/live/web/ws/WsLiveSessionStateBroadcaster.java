package com.liveclass.live.web.ws;

import com.liveclass.live.api.LiveSessionEndedEvent;
import com.liveclass.live.api.LiveSessionEndingEvent;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/** 커밋된 ENDING·ENDED를 세션 상태 토픽으로 전파한다. */
@Component
public class WsLiveSessionStateBroadcaster {

    static final String ENDING_EVENT_TYPE = "session.ending";
    static final String ENDED_EVENT_TYPE = "session.ended";

    private final SimpMessagingTemplate messagingTemplate;

    public WsLiveSessionStateBroadcaster(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onEnding(LiveSessionEndingEvent event) {
        send(event.sessionId(), WsEnvelope.of(
                ENDING_EVENT_TYPE,
                event.sessionId(),
                event.occurredAt(),
                new LiveSessionStatePayload("ENDING", null)));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onEnded(LiveSessionEndedEvent event) {
        send(event.sessionId(), WsEnvelope.of(
                ENDED_EVENT_TYPE,
                event.sessionId(),
                event.endedAt(),
                new LiveSessionStatePayload("ENDED", event.endedAt())));
    }

    private void send(java.util.UUID sessionId, WsEnvelope envelope) {
        messagingTemplate.convertAndSend(
                "/topic/live-sessions/" + sessionId + "/state",
                envelope);
    }
}
