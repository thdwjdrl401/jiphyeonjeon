package com.liveclass.live.web.ws;

import com.liveclass.live.api.LiveSessionEndedEvent;
import com.liveclass.live.api.LiveSessionEndingEvent;
import com.liveclass.live.api.LiveSessionStartedEvent;
import com.liveclass.live.api.LiveSessionStartingEvent;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.OffsetDateTime;

/**
 * 커밋된 세션 상태 전이를 상태 토픽으로 전파한다.
 *
 * <p><b>시작 쪽도 함께 내보낸다.</b> 예전에는 ENDING·ENDED만 보냈는데, 수강생은 강사가 시작하기 전에도
 * 강의실에 들어와 있을 수 있다(입장창은 시계가 열고 강사가 여는 것이 아니다). 시작을 알리는 이벤트가
 * 없으면 그 사람은 강의가 시작된 줄 모르고 새로고침해야 했다 — 대기 화면에서 재생 화면으로 넘어가는
 * 유일한 신호가 이것이다.
 *
 * <p>네 이벤트 모두 이미 발행되던 도메인 이벤트에 리스너만 붙인 것이며, {@code AFTER_COMMIT}이라
 * 롤백된 전이는 나가지 않는다.
 */
@Component
public class WsLiveSessionStateBroadcaster {

    static final String STARTING_EVENT_TYPE = "session.starting";
    static final String STARTED_EVENT_TYPE = "session.started";
    static final String ENDING_EVENT_TYPE = "session.ending";
    static final String ENDED_EVENT_TYPE = "session.ended";

    private final SimpMessagingTemplate messagingTemplate;

    public WsLiveSessionStateBroadcaster(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * 강사가 시작을 눌러 세션이 {@code STARTING}이 됐다. 아직 볼 것은 없지만 <b>기다림의 성격이 바뀐다</b> —
     * 시작 게이트(STT dispatch·Egress·마이크 확인)는 수 초가 걸리므로, 이 신호가 없으면 그동안 화면이
     * 시작 전과 구분되지 않는다.
     *
     * <p>봉투 시각은 발행 시각이다. {@link LiveSessionStartingEvent}는 시작 게이트를 나르는 작업 이벤트라
     * 도메인 시각을 갖지 않고, {@code claim}이 재구성하기도 해서 실을 값이 없다 — 같은 토픽의
     * {@code session.presence}도 같은 규칙을 쓴다.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onStarting(LiveSessionStartingEvent event) {
        send(event.sessionId(), WsEnvelope.of(
                STARTING_EVENT_TYPE,
                event.sessionId(),
                OffsetDateTime.now(),
                new LiveSessionStatePayload("STARTING", null)));
    }

    /** 세션이 {@code LIVE}가 됐다 — 수강생이 실제로 재생할 수 있는 시점이다. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onStarted(LiveSessionStartedEvent event) {
        send(event.sessionId(), WsEnvelope.of(
                STARTED_EVENT_TYPE,
                event.sessionId(),
                event.startedAt(),
                new LiveSessionStatePayload("LIVE", null)));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onEnding(LiveSessionEndingEvent event) {
        send(event.sessionId(), WsEnvelope.of(
                ENDING_EVENT_TYPE,
                event.sessionId(),
                event.occurredAt(),
                new LiveSessionStatePayload("ENDING", null)));
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onEnded(LiveSessionEndedEvent event) {
        send(event.sessionId(), WsEnvelope.of(
                ENDED_EVENT_TYPE,
                event.sessionId(),
                event.endedAt(),
                new LiveSessionStatePayload("ENDED", event.endedAt())));
    }

    private void send(java.util.UUID sessionId, WsEnvelope envelope) {
        messagingTemplate.convertAndSend(
                "/topic/live-sessions/" + sessionId + "/state",
                envelope);
    }
}
