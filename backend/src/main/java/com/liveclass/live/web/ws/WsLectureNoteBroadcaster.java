package com.liveclass.live.web.ws;

import com.liveclass.live.api.LiveLectureNoteView;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;

/**
 * 갱신된 강의 노트를 세션 노트 토픽으로 전파한다.
 *
 * <p><b>전용 토픽을 쓴다.</b> 자막·채팅과 달리 노트는 통째로 교체되는 큰 payload라, 상태 토픽에 섞으면
 * 종료 신호를 기다리는 수신자에게까지 매번 전체 노트가 간다. 대신 구독 인가 허용목록에 정확히 하나를
 * 추가한다 — ADR-0019의 와일드카드 차단 불변식은 그대로다.
 */
@Component
public class WsLectureNoteBroadcaster {

    static final String NOTE_EVENT_TYPE = "lecture.note.updated";

    private final SimpMessagingTemplate messagingTemplate;

    public WsLectureNoteBroadcaster(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    public void broadcast(LiveLectureNoteView note) {
        messagingTemplate.convertAndSend(
                "/topic/live-sessions/" + note.sessionId() + "/notes",
                WsEnvelope.of(NOTE_EVENT_TYPE, note.sessionId(), OffsetDateTime.now(),
                        new LectureNotePayload(note.coveredThroughSequence(), note.topics(),
                                note.markdown(), note.status(), note.updatedAt())));
    }
}
