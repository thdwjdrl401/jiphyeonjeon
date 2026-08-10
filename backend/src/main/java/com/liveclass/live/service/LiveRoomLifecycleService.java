package com.liveclass.live.service;

import com.liveclass.live.api.LiveRoomLifecycle;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * LiveKit이 방을 닫았다는 신호를 세션 종료로 옮긴다(ADR-0119).
 *
 * <p>LiveKit은 방에서 마지막 참가자가 나가고 {@code empty_timeout}이 지나면 방을 닫고
 * {@code room_finished}를 보낸다. 그 시점에 우리 세션이 아직 진행 계열이면, 강사가 종료를 누르지
 * 않고 창을 닫았다는 뜻이다.
 *
 * <p><b>이것만으로는 부족하다.</b> 강사만 나가고 학생이 남아 있으면 방이 닫히지 않아 이 신호가
 * 오지 않는다. 그 구멍은 {@link LiveEndReconciler}가 덮는다 — 이쪽은 빠르고 정확하지만 조건이
 * 좁고, 저쪽은 느리지만 모든 경우를 본다.
 */
@Service
public class LiveRoomLifecycleService implements LiveRoomLifecycle {

    private static final Logger log = LoggerFactory.getLogger(LiveRoomLifecycleService.class);
    private static final String ROOM_PREFIX = "session-";

    private final LiveEndOrchestrator endOrchestrator;

    public LiveRoomLifecycleService(LiveEndOrchestrator endOrchestrator) {
        this.endOrchestrator = endOrchestrator;
    }

    @Override
    public void onRoomFinished(String roomName) {
        UUID sessionId = sessionIdOf(roomName);
        if (sessionId == null) {
            // 우리 규칙이 아닌 방 이름. 같은 LiveKit을 다른 용도로 쓰면 정상적으로 생기는 일이다.
            log.debug("room_finished 무시 — 세션 방이 아님 room={}", roomName);
            return;
        }
        try {
            endOrchestrator.endBySystem(sessionId, "LiveKit room_finished");
        } catch (RuntimeException e) {
            /*
             * webhook에 500을 돌려주면 LiveKit이 재시도한다. 그 재시도가 도움이 되는 실패도 있지만
             * (DB 순간 장애) 대부분은 같은 결과다. 여기서 삼키고 로그를 남긴다 — 남은 유령 세션은
             * 재조정 루프가 어차피 다시 집는다.
             */
            log.warn("room_finished 처리 실패 session={} room={}: {}", sessionId, roomName, e.toString());
        }
    }

    /** {@code session-<uuid>} 규칙의 역함수. 규칙이 아니면 null. */
    private static UUID sessionIdOf(String roomName) {
        if (roomName == null || !roomName.startsWith(ROOM_PREFIX)) {
            return null;
        }
        try {
            return UUID.fromString(roomName.substring(ROOM_PREFIX.length()));
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
