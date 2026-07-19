package com.liveclass.live.web.ws;

import com.liveclass.live.service.ChatService;
import com.liveclass.live.web.dto.SendChatMessageRequest;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.stereotype.Controller;

import java.security.Principal;
import java.util.UUID;

/**
 * 실시간 채팅 인바운드(STOMP). 클라이언트가 {@code /app/live-sessions/{sessionId}/chat}으로 보내면
 * 저장(멱등)하고, 저장되면 {@link WsChatBroadcaster}가 커밋 후 구독자에게 브로드캐스트한다.
 *
 * <p>인증은 핸드셰이크(쿠키 세션)에서 이미 끝났으므로 {@code Principal.getName()} = userId다. REST 전송은
 * 그대로 fallback으로 남는다(CHAT-01) — 둘 다 같은 저장·브로드캐스트 경로를 탄다.
 */
@Controller
public class ChatWsController {

    private final ChatService chatService;

    public ChatWsController(ChatService chatService) {
        this.chatService = chatService;
    }

    @MessageMapping("/live-sessions/{sessionId}/chat")
    public void send(@DestinationVariable UUID sessionId, SendChatMessageRequest request, Principal principal) {
        if (principal == null) {
            // 핸드셰이크가 인증을 강제하므로 정상 흐름에선 오지 않는다 — 방어적 차단.
            throw new IllegalStateException("인증되지 않은 WebSocket 세션입니다.");
        }
        if (request == null || request.clientMessageId() == null || request.clientMessageId().isBlank()
                || request.text() == null || request.text().isBlank()) {
            throw new IllegalArgumentException("clientMessageId와 text는 필수입니다.");
        }
        UUID senderId = UUID.fromString(principal.getName());
        chatService.sendToSession(sessionId, senderId, request.clientMessageId(),
                request.text(), Boolean.TRUE.equals(request.isQuestion()));
    }
}
