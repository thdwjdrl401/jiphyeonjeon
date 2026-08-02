package com.liveclass.live.service;

import com.liveclass.live.api.LiveRecordingControl;
import com.liveclass.live.api.LiveSessionView;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * 라이브 종료 동기 순차 오케스트레이터(ADR choinhoo/0003).
 *
 * <p>이 빈에는 {@code @Transactional}을 붙이지 않는다. ENDING과 ENDED는
 * {@link LiveEndTransitions}의 서로 다른 짧은 트랜잭션으로 커밋하고, 외부 I/O는 그 사이에서 수행한다.
 */
@Service
public class LiveEndOrchestrator {

    private static final Logger log = LoggerFactory.getLogger(LiveEndOrchestrator.class);

    private final LiveEndTransitions transitions;
    private final LiveRoomControl roomControl;
    private final LiveRecordingControl recordingControl;

    public LiveEndOrchestrator(LiveEndTransitions transitions,
                               LiveRoomControl roomControl,
                               LiveRecordingControl recordingControl) {
        this.transitions = transitions;
        this.roomControl = roomControl;
        this.recordingControl = recordingControl;
    }

    public LiveSessionView end(UUID sessionId, UUID requesterId) {
        LiveEndTransitions.BeginEndResult begin = transitions.beginOrReuse(sessionId, requesterId);
        if (begin.alreadyEnded()) {
            return begin.session();
        }

        // Room 삭제 실패는 상위로 전파한다. ENDING은 이미 커밋됐으며 강사의 같은 요청으로 재시도한다.
        roomControl.closeRoom(LiveSessionService.roomName(sessionId));

        // 현재 구현에 남은 best-effort 보완 호출이다. MVP 종료 계약은 Room 삭제까지만 요구한다.
        // 녹화 정리는 별도 상태축이므로 실패해도 라이브 종료를 되돌리거나 ENDED 전이를 막지 않는다.
        try {
            recordingControl.stopRecording(sessionId);
        } catch (RuntimeException e) {
            log.warn("종료 중 Egress 중지 실패(라이브 종료는 계속) session={}: {}", sessionId, e.getMessage());
        }

        return transitions.complete(sessionId, requesterId);
    }
}
