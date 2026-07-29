package com.liveclass.live.web.ws;

import com.liveclass.live.service.CaptionEvent;
import com.liveclass.live.service.LiveCaptionStoredEvent;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 적재된 자막을 {@code /topic/live-sessions/{sessionId}/captions} 구독자에게 실시간 전달한다
 * (CONTRACT §3-4·§3-6, {@code WsChatBroadcaster}와 동형). 커밋 후에만 발행하므로 저장된 자막만
 * 흘러나간다 — 멱등 중복은 {@link LiveCaptionStoredEvent}가 발행되지 않아 자연히 제외된다.
 *
 * <p>payload는 camelCase이고 {@code streamElapsedMs}는 raw 값 그대로다(변환 금지, CONTRACT §3-4).
 */
@Component
public class WsCaptionBroadcaster {

    private final SimpMessagingTemplate messagingTemplate;

    public WsCaptionBroadcaster(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onStored(LiveCaptionStoredEvent event) {
        Object payload = CaptionEvent.TYPE_COMPLETED.equals(event.eventType())
                ? CaptionCompletedPayload.from(event)
                : CaptionDeltaPayload.from(event);
        WsEnvelope envelope = WsEnvelope.of(event.eventType(), event.sessionId(), event.occurredAt(), payload);
        messagingTemplate.convertAndSend(
                "/topic/live-sessions/" + event.sessionId() + "/captions", envelope);
    }
}
