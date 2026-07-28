package com.liveclass.live.service;

import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.repository.LiveSessionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * LiveKit 외부 I/O와 roomSid DB 갱신을 분리하는 짧은 트랜잭션 경계(ADR-0002 §3).
 */
@Service
public class LivePreflightRoomStore {

    private final LiveSessionRepository liveSessionRepository;

    public LivePreflightRoomStore(LiveSessionRepository liveSessionRepository) {
        this.liveSessionRepository = liveSessionRepository;
    }

    @Transactional
    public void saveRoomSid(UUID sessionId, UUID requesterId, String roomSid) {
        LiveSession session = liveSessionRepository.findByIdForUpdate(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
        if (!session.getInstructorId().equals(requesterId)) {
            throw new LiveSessionForbiddenException("이 세션의 강사만 할 수 있습니다.");
        }
        if (session.getStatus() == LiveSessionStatus.ENDING
                || session.getStatus() == LiveSessionStatus.ENDED
                || session.getStatus() == LiveSessionStatus.CANCELLED
                || session.getStatus() == LiveSessionStatus.FAILED) {
            throw new LiveSessionStateConflictException("이미 종료되었거나 시작할 수 없는 상태입니다.");
        }
        session.setRoomSid(roomSid);
    }
}
