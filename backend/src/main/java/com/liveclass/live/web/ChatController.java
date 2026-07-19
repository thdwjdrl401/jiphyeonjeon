package com.liveclass.live.web;

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
import java.util.UUID;

/**
 * 라이브 채팅 저장·복구(REST). 실시간 push(WebSocket)는 별도 후속 — 이건 접속·새로고침·되감기 때
 * 과거 채팅을 복구하고 WS가 없거나 끊겨도 채팅이 남게 하는 뼈대다.
 * 프라이버시: 응답에 실명·userId를 넣지 않고 가명만 노출한다.
 */
@Tag(name = "라이브 채팅", description = "채팅 저장·복구(REST). 실시간 전달은 WebSocket으로 별도.")
@RestController
public class ChatController {

    private final ChatService chatService;

    public ChatController(ChatService chatService) {
        this.chatService = chatService;
    }

    @Operation(summary = "채팅 전송", description = "채팅 한 줄을 저장한다. 같은 clientMessageId로 다시 보내도 중복 저장되지 않는다(재전송 안전).")
    @PostMapping("/api/lessons/{lessonId}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    public ChatMessageResponse send(@PathVariable UUID lessonId,
                                    @Valid @RequestBody SendChatMessageRequest request,
                                    Authentication authentication) {
        var saved = chatService.send(lessonId, UUID.fromString(authentication.getName()),
                request.clientMessageId(), request.text(), Boolean.TRUE.equals(request.isQuestion()));
        return ChatMessageResponse.from(saved, request.viewingSessionMs());
    }

    @Operation(summary = "채팅 복구 조회", description = "저장된 채팅을 시각순으로 불러온다. afterSessionMs 이후만. 접속·새로고침·되감기 때 과거 채팅 복구용.")
    @GetMapping("/api/lessons/{lessonId}/messages")
    public List<ChatMessageResponse> list(@PathVariable UUID lessonId,
                                          @RequestParam(defaultValue = "-1") long afterSessionMs,
                                          @RequestParam(defaultValue = "100") int limit) {
        return chatService.list(lessonId, afterSessionMs, limit).stream()
                .map(m -> ChatMessageResponse.from(m, null))
                .toList();
    }
}
