package com.liveclass.live.web.ws;

import com.liveclass.common.web.ErrorResponse;
import com.liveclass.live.service.ChatService;
import com.liveclass.live.service.LiveSessionForbiddenException;
import com.liveclass.live.service.LiveSessionNotFoundException;
import com.liveclass.live.service.LiveSessionStateConflictException;
import com.liveclass.live.web.dto.SendChatMessageRequest;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.annotation.SendToUser;
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

    /** 채팅 본문 최대 길이. REST DTO의 @Size(max=2000)와 동일하게 WS 경로에서도 강제한다. */
    private static final int MAX_TEXT_LENGTH = 2000;

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
        if (request.text().length() > MAX_TEXT_LENGTH) {
            throw new IllegalArgumentException("메시지는 " + MAX_TEXT_LENGTH + "자를 초과할 수 없습니다.");
        }
        UUID senderId = UUID.fromString(principal.getName());
        chatService.sendToSession(sessionId, senderId, request.clientMessageId(),
                request.text(), Boolean.TRUE.equals(request.isQuestion()),
                Boolean.TRUE.equals(request.anonymous()));
    }

    // ── STOMP 오류 변환 ──
    // @RestControllerAdvice는 HTTP 전용이라 STOMP 프레임엔 관여하지 않는다. 여기서 잡지 않으면 예외가
    // 조용히 삼켜지고(로그만) 클라이언트는 아무 응답도 못 받는다. 사용자 개인 큐로 ErrorResponse를 돌려준다.

    @MessageExceptionHandler({LiveSessionNotFoundException.class})
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public ErrorResponse handleNotFound(LiveSessionNotFoundException e) {
        return ErrorResponse.of("LIVE_SESSION_NOT_FOUND", e.getMessage());
    }

    @MessageExceptionHandler({LiveSessionForbiddenException.class})
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public ErrorResponse handleForbidden(LiveSessionForbiddenException e) {
        return ErrorResponse.of("LIVE_SESSION_FORBIDDEN", e.getMessage());
    }

    @MessageExceptionHandler({LiveSessionStateConflictException.class})
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public ErrorResponse handleStateConflict(LiveSessionStateConflictException e) {
        return ErrorResponse.of("LIVE_SESSION_STATE_CONFLICT", e.getMessage());
    }

    /** 잘못된 입력(필수 누락·길이 초과) → 400 계열. */
    @MessageExceptionHandler({IllegalArgumentException.class})
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public ErrorResponse handleBadRequest(IllegalArgumentException e) {
        return ErrorResponse.of("CHAT_INVALID_REQUEST", e.getMessage());
    }

    /** 인증 누락 등 예기치 못한 상태 → 서버 오류로 알린다. */
    @MessageExceptionHandler({IllegalStateException.class})
    @SendToUser(destinations = "/queue/errors", broadcast = false)
    public ErrorResponse handleIllegalState(IllegalStateException e) {
        return ErrorResponse.of("CHAT_ERROR", e.getMessage());
    }
}
