package com.liveclass.live.repository;

import com.liveclass.live.domain.ChatMessage;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface ChatMessageRepository extends JpaRepository<ChatMessage, Long> {

    /** 멱등 전송용: 같은 세션에 같은 client_message_id가 이미 있으면 그걸 돌려준다. */
    Optional<ChatMessage> findByLiveSessionIdAndClientMessageId(UUID liveSessionId, String clientMessageId);

    /** 복구 조회: 특정 시각(ms) 이후 삭제되지 않은 메시지를 시각순으로. */
    java.util.List<ChatMessage> findByLiveSessionIdAndSessionMsGreaterThanAndDeletedAtIsNullOrderBySessionMsAsc(
            UUID liveSessionId, long afterSessionMs, Limit limit);
}
