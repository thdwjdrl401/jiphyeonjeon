package com.liveclass.live.service;

import com.liveclass.auth.api.UserDirectory;
import com.liveclass.auth.api.UserView;
import com.liveclass.live.domain.ChatMessage;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.repository.ChatMessageRepository;
import com.liveclass.live.repository.LiveSessionRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
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
    private final ApplicationEventPublisher eventPublisher;
    private final LiveAccessGuard accessGuard;
    private final LiveInteractionGuard interactionGuard;

    public ChatService(ChatMessageRepository chatMessageRepository,
                       LiveSessionRepository liveSessionRepository,
                       UserDirectory userDirectory,
                       ApplicationEventPublisher eventPublisher,
                       LiveAccessGuard accessGuard,
                       LiveInteractionGuard interactionGuard) {
        this.chatMessageRepository = chatMessageRepository;
        this.liveSessionRepository = liveSessionRepository;
        this.userDirectory = userDirectory;
        this.eventPublisher = eventPublisher;
        this.accessGuard = accessGuard;
        this.interactionGuard = interactionGuard;
    }

    /**
     * 채팅 전송(멱등, sessionId 기준). REST·WebSocket 모두 이 경로로 들어온다 — 채팅은 라이브 세션 범위라
     * sessionId로 키잉한다(WS 채널·구독 destination과 일치). lesson:session=1:1이 나중에 1:N이 돼도
     * sessionId 키잉이라 이 코드가 안 깨진다. lessonId는 세션에서 얻어 메시지에 비정규화만 한다.
     *
     * @param anonymousRequested 발신자가 익명 전송을 선택했는지(ADR-0050). 학생만 유효하며 강사는 무시된다.
     */
    @Transactional
    public ChatMessage sendToSession(UUID sessionId, UUID senderId, String clientMessageId, String text,
                                     boolean isQuestion, boolean anonymousRequested) {
        // 세션 상태 전이와 채팅 저장을 같은 행 잠금으로 직렬화한다. ENDED도 후속 토론을 위해 허용하고,
        // 시작 전·취소·실패 상태만 저장 전에 거절한다.
        LiveSession session = liveSessionRepository.findByIdForUpdate(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션이 없습니다."));
        interactionGuard.requireInteractionAllowed(session);
        return sendIdempotent(session, session.getLessonId(), senderId, clientMessageId, text, isQuestion, anonymousRequested);
    }

    /**
     * 멱등 전송: 이미 있으면 그 행, 없으면 저장. 같은 clientMessageId가 동시에 들어와 SELECT를 둘 다 통과하면
     * 하나는 UNIQUE(live_session_id, client_message_id) 위반이 난다 → 500 대신 409(STATE_CONFLICT)로 매핑한다.
     * 채팅은 clientMessageId로 재전송 안전하므로, 클라 재시도가 위 SELECT 경로로 기존 메시지를 받아 멱등이 유지된다.
     */
    private ChatMessage sendIdempotent(LiveSession session, UUID lessonId, UUID senderId,
                                       String clientMessageId, String text, boolean isQuestion,
                                       boolean anonymousRequested) {
        // 접근 게이트: 소유 강사이거나 소속 커리큘럼의 활성 수강생만 채팅 전송 가능(REST·WS 공용 경로).
        accessGuard.requireCanAccess(session.getId(), senderId);
        return chatMessageRepository.findByLiveSessionIdAndClientMessageId(session.getId(), clientMessageId)
                .orElseGet(() -> {
                    try {
                        return store(session, lessonId, senderId, clientMessageId, text, isQuestion, anonymousRequested);
                    } catch (DataIntegrityViolationException race) {
                        throw new LiveSessionStateConflictException("같은 메시지가 동시에 저장되었습니다. 다시 시도해 주세요.");
                    }
                });
    }

    /** 복구 조회(sessionId 기준): afterSessionMs 이후 삭제 안 된 메시지를 시각순으로. 세션 없으면 404, 미접근 403. */
    @Transactional(readOnly = true)
    public List<ChatMessage> listBySession(UUID sessionId, UUID requesterId, long afterSessionMs, int limit) {
        // 접근 게이트: 소유 강사이거나 활성 수강생만 채팅 이력 조회 가능(전송과 동일 게이트). 세션 없으면 404.
        // 수강생에게는 시작 전 409다 — 전송이 막혀 있으므로 그때 조회할 이력이 있을 수 없다.
        accessGuard.requireCanReadContent(sessionId, requesterId);
        int capped = Math.min(Math.max(limit, 1), 200);
        return chatMessageRepository.findByLiveSessionIdAndSessionMsGreaterThanAndDeletedAtIsNullOrderBySessionMsAsc(
                sessionId, afterSessionMs, Limit.of(capped));
    }

    private ChatMessage store(LiveSession session, UUID lessonId, UUID senderId,
                              String clientMessageId, String text, boolean isQuestion,
                              boolean anonymousRequested) {
        UserView sender = userDirectory.findById(senderId)
                .orElseThrow(() -> new IllegalStateException("보낸 사용자를 찾을 수 없습니다: " + senderId));
        // 익명은 발신자가 켰을 때만이다(ADR-0050). 강사는 어떤 요청을 보내도 익명이 될 수 없다 —
        // 누가 강의를 진행하는지는 수업 진행상 드러나야 하고, 강사 익명은 사회자 없는 채팅이 된다.
        boolean anonymous = !"INSTRUCTOR".equals(sender.role()) && anonymousRequested;

        ChatMessage m = new ChatMessage();
        m.setLiveSessionId(session.getId());
        m.setLessonId(lessonId);
        m.setUserId(senderId);
        m.setAnonymous(anonymous);
        // sender_name엔 응답에 노출해도 안전한 값만 저장한다 — 익명이면 세션 한정 가명, 아니면 발신자가
        // 스스로 지정한 표시 이름(displayName)이다. 실명 필드나 내부 userId는 응답에 넣지 않는다.
        m.setSenderName(anonymous ? studentAlias(session.getId(), senderId) : sender.displayName());
        m.setSessionMs(elapsedMs(session));
        m.setText(text);
        m.setQuestion(isQuestion);
        m.setClientMessageId(clientMessageId);
        // PK가 IDENTITY라 save()가 즉시 INSERT → id·createdAt(@CreationTimestamp)이 여기서 채워진다.
        ChatMessage saved = chatMessageRepository.save(m);

        // 저장이 실제로 일어난 경우에만 발행 → 커밋 후 리스너가 브로드캐스트한다(REST·WS 공용 실시간 경로).
        eventPublisher.publishEvent(new ChatMessageStoredEvent(
                saved.getLiveSessionId(), saved.getLessonId(), String.valueOf(saved.getId()),
                saved.getClientMessageId(), saved.getSenderName(), saved.getSessionMs(),
                saved.getText(), saved.isQuestion(), saved.getCreatedAt()));
        return saved;
    }

    /** 라이브 시작(clock_origin_at) 기준 경과 ms. 아직 시작 전이면 0. */
    private long elapsedMs(LiveSession session) {
        if (session.getClockOriginAt() == null) {
            return 0L;
        }
        return Math.max(0L, Duration.between(session.getClockOriginAt(), OffsetDateTime.now()).toMillis());
    }

    /**
     * 수강생 가명(익명 전송을 선택했을 때만 쓰인다). 세션+사용자에 결정론적이라 같은 학생이 익명으로
     * 여러 번 보내면 한 세션 내내 같은 가명을 갖는다.
     * 순차 "수강생 N"(1,2,3…) 부여는 세션별 카운터가 필요해 후속(정책 확정).
     */
    private String studentAlias(UUID sessionId, UUID userId) {
        int code = Math.abs((sessionId.toString() + userId).hashCode()) % 10000;
        return "수강생-" + String.format("%04d", code);
    }
}
