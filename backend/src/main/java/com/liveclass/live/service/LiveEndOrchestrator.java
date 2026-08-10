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

    /**
     * 강사가 종료를 누르지 않은 채 사라진 세션을 시스템이 끝낸다(ADR-0119).
     *
     * <p>사람이 부르는 {@link #end}와 <b>외부 제어 실패를 다루는 방식이 다르다.</b> 저쪽은 Room 삭제가
     * 실패하면 예외를 올려 강사가 다시 누르게 하지만, 여기는 다시 누를 사람이 없다. 게다가 이 경로가
     * 열리는 조건 자체가 <b>방이 이미 없거나 비어 있다</b>는 것이라, 실패의 대부분은 "지울 게 없다"다.
     * 그래서 로그만 남기고 ENDED까지 간다 — 여기서 멈추면 세션이 ENDING에 갇혀 문제가 그대로 남는다.
     *
     * @return 이번 호출이 실제로 종료시켰으면 true. 이미 끝났거나 손댈 상태가 아니면 false.
     */
    public boolean endBySystem(UUID sessionId, String reason) {
        var begin = transitions.beginBySystem(sessionId);
        if (begin.isEmpty() || begin.get().alreadyEnded()) {
            return false;
        }

        try {
            roomControl.closeRoom(LiveSessionService.roomName(sessionId));
        } catch (RuntimeException e) {
            log.warn("시스템 종료 중 Room 삭제 실패(계속 진행) session={}: {}", sessionId, e.getMessage());
        }
        try {
            recordingControl.stopRecording(sessionId);
        } catch (RuntimeException e) {
            log.warn("시스템 종료 중 Egress 중지 실패(계속 진행) session={}: {}", sessionId, e.getMessage());
        }

        transitions.completeBySystem(sessionId);
        log.info("시스템이 라이브 세션을 종료함 session={} 사유={}", sessionId, reason);
        return true;
    }
}
