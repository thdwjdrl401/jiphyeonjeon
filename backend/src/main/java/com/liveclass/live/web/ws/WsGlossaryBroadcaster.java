package com.liveclass.live.web.ws;

import com.liveclass.learning.api.LessonGlossaryChangedEvent;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.repository.LiveSessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.OffsetDateTime;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;

/**
 * 용어집이 바뀌면 진행 중인 라이브 화면에 "다시 읽어라"를 보낸다.
 *
 * <p><b>왜 폴링이 아니라 푸시인가.</b> 자료 상태 폴링(ADR-0036)은 끝나면 스스로 멈출 수 있어서 값이
 * 싸다. 라이브 화면의 용어집은 그렇지 않다 — 수강생 쪽은 임베딩이 끝났는지 알 방법이 없어 폴링이
 * 꺼지지 않고, 라이브는 몇 시간씩 열려 있다. 게다가 이건 세션 스코프 사건이라 자막·노트가 이미
 * 쓰는 토픽 옆에 그대로 놓을 수 있다.
 *
 * <p><b>신호만 보낸다.</b> 용어 원문은 payload에 싣지 않는다 —
 * {@link LessonGlossaryChangedEvent} 주석 참고.
 */
@Component
public class WsGlossaryBroadcaster {

    private static final Logger log = LoggerFactory.getLogger(WsGlossaryBroadcaster.class);

    static final String GLOSSARY_EVENT_TYPE = "lesson.glossary.updated";

    /**
     * 지금 화면이 열려 있을 수 있는 상태. 끝났거나 아직 안 연 세션에 보내 봐야 듣는 사람이 없고,
     * 다시보기는 열 때마다 새로 읽으므로 이 신호가 필요 없다.
     */
    private static final Set<LiveSessionStatus> LISTENING = EnumSet.of(
            LiveSessionStatus.OPEN, LiveSessionStatus.STARTING, LiveSessionStatus.LIVE);

    private final SimpMessagingTemplate messagingTemplate;
    private final LiveSessionRepository liveSessionRepository;

    public WsGlossaryBroadcaster(SimpMessagingTemplate messagingTemplate,
                                 LiveSessionRepository liveSessionRepository) {
        this.messagingTemplate = messagingTemplate;
        this.liveSessionRepository = liveSessionRepository;
    }

    /**
     * 커밋 후에 보낸다. 커밋 전에 보내면 화면이 다시 읽으러 왔을 때 아직 저장 전이라 옛 용어집을
     * 받고, 그게 최신인 줄 알고 눌러앉는다 — 다음 신호가 올 때까지 틀린 화면이 유지된다.
     *
     * <p>롤백되면 아예 보내지 않는다({@code AFTER_COMMIT} 기본 동작).
     */
    @TransactionalEventListener
    // 커밋 뒤에 도는 자리라 원래 트랜잭션은 이미 끝나 있다. 조회용 트랜잭션을 새로 연다 —
    // REQUIRES_NEW 없이 @Transactional을 붙이면 Spring이 기동 시점에 거부한다.
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public void onGlossaryChanged(LessonGlossaryChangedEvent event) {
        UUID lessonId = event.lessonId();
        liveSessionRepository.findByLessonId(lessonId)
                .filter(session -> LISTENING.contains(session.getStatus()))
                .ifPresent(session -> broadcast(session, event));
    }

    private void broadcast(LiveSession session, LessonGlossaryChangedEvent event) {
        UUID sessionId = session.getId();
        messagingTemplate.convertAndSend(
                "/topic/live-sessions/" + sessionId + "/glossary",
                WsEnvelope.of(GLOSSARY_EVENT_TYPE, sessionId, OffsetDateTime.now(),
                        new GlossaryChangedPayload(event.lessonId().toString(), event.reason().name())));
        log.info("용어집 갱신 전파 sessionId={} lessonId={} reason={}", sessionId, event.lessonId(), event.reason());
    }

    /**
     * 용어가 아니라 "무엇이 왜 바뀌었는지"만. 화면은 이걸 보고 자기 권한으로 용어집을 다시 읽는다.
     */
    record GlossaryChangedPayload(String lessonId, String reason) {
    }
}
