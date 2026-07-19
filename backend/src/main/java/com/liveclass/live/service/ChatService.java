package com.liveclass.live.service;

import com.liveclass.auth.api.UserDirectory;
import com.liveclass.auth.api.UserView;
import com.liveclass.live.domain.ChatMessage;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.repository.ChatMessageRepository;
import com.liveclass.live.repository.LiveSessionRepository;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 라이브 채팅 저장·복구(REST). 실시간 전달(WebSocket)은 별도 후속 — 이건 DB 저장/조회 뼈대다.
 * lesson : liveSession = 1:1(MVP)이라 lessonId로 세션을 찾는다.
 */
@Service
public class ChatService {

    private final ChatMessageRepository chatMessageRepository;
    private final LiveSessionRepository liveSessionRepository;
    private final UserDirectory userDirectory;

    public ChatService(ChatMessageRepository chatMessageRepository,
                       LiveSessionRepository liveSessionRepository,
                       UserDirectory userDirectory) {
        this.chatMessageRepository = chatMessageRepository;
        this.liveSessionRepository = liveSessionRepository;
        this.userDirectory = userDirectory;
    }

    /** 채팅 전송(멱등). 같은 clientMessageId 재전송이면 기존 메시지를 그대로 돌려준다. */
    @Transactional
    public ChatMessage send(UUID lessonId, UUID senderId, String clientMessageId, String text, boolean isQuestion) {
        LiveSession session = sessionForLesson(lessonId);

        return chatMessageRepository
                .findByLiveSessionIdAndClientMessageId(session.getId(), clientMessageId)
                .orElseGet(() -> store(session, lessonId, senderId, clientMessageId, text, isQuestion));
    }

    /** 복구 조회: afterSessionMs 이후 삭제 안 된 메시지를 시각순으로. */
    @Transactional(readOnly = true)
    public List<ChatMessage> list(UUID lessonId, long afterSessionMs, int limit) {
        LiveSession session = sessionForLesson(lessonId);
        int capped = Math.min(Math.max(limit, 1), 200);
        return chatMessageRepository.findByLiveSessionIdAndSessionMsGreaterThanAndDeletedAtIsNullOrderBySessionMsAsc(
                session.getId(), afterSessionMs, Limit.of(capped));
    }

    private ChatMessage store(LiveSession session, UUID lessonId, UUID senderId,
                              String clientMessageId, String text, boolean isQuestion) {
        UserView sender = userDirectory.findById(senderId)
                .orElseThrow(() -> new IllegalStateException("보낸 사용자를 찾을 수 없습니다: " + senderId));
        boolean anonymous = !"INSTRUCTOR".equals(sender.role());

        ChatMessage m = new ChatMessage();
        m.setLiveSessionId(session.getId());
        m.setLessonId(lessonId);
        m.setUserId(senderId);
        m.setAnonymous(anonymous);
        // sender_name엔 응답에 노출해도 안전한 가명을 저장한다 — 학생 실명·userId는 저장·응답 어디에도 안 남긴다.
        m.setSenderName(anonymous ? studentAlias(session.getId(), senderId) : sender.displayName());
        m.setSessionMs(elapsedMs(session));
        m.setText(text);
        m.setQuestion(isQuestion);
        m.setClientMessageId(clientMessageId);
        return chatMessageRepository.save(m);
    }

    /** 라이브 시작(clock_origin_at) 기준 경과 ms. 아직 시작 전이면 0. */
    private long elapsedMs(LiveSession session) {
        if (session.getClockOriginAt() == null) {
            return 0L;
        }
        return Math.max(0L, Duration.between(session.getClockOriginAt(), OffsetDateTime.now()).toMillis());
    }

    /**
     * 수강생 가명. 세션+사용자에 결정론적이라 같은 학생은 한 세션 내내 같은 가명을 갖는다.
     * 순차 "수강생 N"(1,2,3…) 부여는 세션별 카운터가 필요해 후속(정책 확정).
     */
    private String studentAlias(UUID sessionId, UUID userId) {
        int code = Math.abs((sessionId.toString() + userId).hashCode()) % 10000;
        return "수강생-" + String.format("%04d", code);
    }

    private LiveSession sessionForLesson(UUID lessonId) {
        return liveSessionRepository.findByLessonId(lessonId)
                .orElseThrow(() -> new LiveSessionNotFoundException("이 레슨의 라이브 세션이 없습니다."));
    }
}
