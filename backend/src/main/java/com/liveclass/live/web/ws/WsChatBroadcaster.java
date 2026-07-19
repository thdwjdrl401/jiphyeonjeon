package com.liveclass.live.web.ws;

import com.liveclass.live.service.ChatMessageStoredEvent;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 저장된 채팅을 {@code /topic/live-sessions/{sessionId}/chat} 구독자에게 실시간 전달한다(LIVE.md §8).
 * 커밋 후에만 발행하므로 롤백된 메시지는 흘러나가지 않는다. REST POST·WS SEND 어느 경로로 저장됐든
 * 동일하게 브로드캐스트된다 — 전송 경로가 아니라 "저장됨" 이벤트에 반응하기 때문.
 */
@Component
public class WsChatBroadcaster {

    static final String EVENT_TYPE = "chat.message.created";

    private final SimpMessagingTemplate messagingTemplate;

    public WsChatBroadcaster(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onStored(ChatMessageStoredEvent event) {
        WsEnvelope envelope = WsEnvelope.of(
                EVENT_TYPE, event.sessionId(), event.createdAt(), ChatMessagePayload.from(event));
        messagingTemplate.convertAndSend("/topic/live-sessions/" + event.sessionId() + "/chat", envelope);
    }
}
