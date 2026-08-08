package com.liveclass.live.web;

import com.liveclass.auth.api.UserDirectory;
import com.liveclass.live.domain.ChatMessage;
import com.liveclass.live.service.ChatService;
import com.liveclass.live.web.dto.ChatMessageResponse;
import com.liveclass.live.web.dto.SendChatMessageRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 라이브 채팅 저장·복구(REST). 실시간 push는 WebSocket으로 별도 — 이건 접속·새로고침·되감기 때
 * 과거 채팅을 복구하고 WS가 없거나 끊겨도 채팅이 남게 하는 뼈대다. 채팅은 라이브 세션 범위라
 * WS와 동일하게 sessionId로 키잉한다(향후 lesson:session 1:N 전환에도 안 깨지게).
 * 프라이버시: 응답에 실명 필드·내부 userId를 넣지 않는다. 노출되는 이름(alias)은 발신자가 익명을 선택하면
 * 세션 한정 가명, 아니면 발신자가 스스로 지정한 표시 이름이다(ADR-0050).
 */
@Tag(name = "라이브 채팅", description = "채팅 저장·복구(REST, 세션 기준). 실시간 전달은 WebSocket으로 별도.")
@RestController
public class ChatController {

    private final ChatService chatService;
    private final UserDirectory userDirectory;

    public ChatController(ChatService chatService, UserDirectory userDirectory) {
        this.chatService = chatService;
        this.userDirectory = userDirectory;
    }

    @Operation(summary = "채팅 전송", description = "채팅 한 줄을 저장한다. 같은 clientMessageId로 다시 보내도 중복 저장되지 않는다(재전송 안전).")
    @PostMapping("/api/live-sessions/{sessionId}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    public ChatMessageResponse send(@PathVariable UUID sessionId,
                                    @Valid @RequestBody SendChatMessageRequest request,
                                    Authentication authentication) {
        UUID requesterId = UUID.fromString(authentication.getName());
        var saved = chatService.sendToSession(sessionId, requesterId,
                request.clientMessageId(), request.text(), Boolean.TRUE.equals(request.isQuestion()),
                Boolean.TRUE.equals(request.anonymous()));
        return ChatMessageResponse.from(saved, request.viewingSessionMs(), requesterId, avatarUrls(List.of(saved)));
    }

    @Operation(summary = "채팅 복구 조회", description = "저장된 채팅을 시각순으로 불러온다. afterSessionMs 이후만. 접속·새로고침·되감기 때 과거 채팅 복구용.")
    @GetMapping("/api/live-sessions/{sessionId}/messages")
    public List<ChatMessageResponse> list(@PathVariable UUID sessionId,
                                          @RequestParam(defaultValue = "-1") long afterSessionMs,
                                          @RequestParam(defaultValue = "100") int limit,
                                          Authentication authentication) {
        UUID requesterId = UUID.fromString(authentication.getName());
        var messages = chatService.listBySession(sessionId, requesterId, afterSessionMs, limit);
        var avatars = avatarUrls(messages);
        return messages.stream()
                .map(m -> ChatMessageResponse.from(m, null, requesterId, avatars))
                .toList();
    }

    /**
     * 한 페이지에 등장한 <b>익명이 아닌</b> 발신자들의 프로필 사진을 한 번에 해석한다.
     *
     * <p>익명 발신자를 애초에 넣지 않는다. {@code ChatMessageResponse}가 익명이면 지도를 보지 않으므로
     * 넣어도 새어 나가지는 않지만, 필요 없는 사람의 URL을 만들 이유도 없다 — presigned URL은 만드는
     * 순간부터 유효하다.
     *
     * <p>메시지 수가 아니라 <b>사람 수</b>만큼만 왕복한다(distinct). 한 사람이 열 줄을 말해도 한 번이다.
     */
    private Map<UUID, String> avatarUrls(List<ChatMessage> messages) {
        var senderIds = messages.stream()
                .filter(m -> !m.isAnonymous())
                .map(ChatMessage::getUserId)
                .distinct()
                .toList();
        return senderIds.isEmpty() ? Map.of() : userDirectory.findAvatarUrls(senderIds);
    }
}
