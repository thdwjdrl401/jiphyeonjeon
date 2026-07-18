package com.liveclass.live.service;

import com.liveclass.live.api.LiveSessionManagement;
import com.liveclass.live.api.LiveSessionView;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.repository.LiveSessionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

/** LiveSessionManagement 구현. 데이터만 담당하고 소유권 검증은 하지 않는다(호출자 책임). */
@Service
public class LiveSessionService implements LiveSessionManagement {

    private final LiveSessionRepository liveSessionRepository;

    public LiveSessionService(LiveSessionRepository liveSessionRepository) {
        this.liveSessionRepository = liveSessionRepository;
    }

    @Override
    @Transactional
    public LiveSessionView create(UUID lessonId, UUID instructorId, OffsetDateTime scheduledAt) {
        LiveSession session = new LiveSession();
        session.setLessonId(lessonId);
        session.setInstructorId(instructorId);
        session.setScheduledAt(scheduledAt);
        session.setStatus(scheduledAt != null ? LiveSessionStatus.SCHEDULED : LiveSessionStatus.DRAFT);
        // 세션 기능 플래그는 DDL 기본값(전부 true)과 맞춘다. 세부 토글은 후속.
        session.setRecordingEnabled(true);
        session.setCaptionEnabled(true);
        session.setChatEnabled(true);
        session.setAiQnaEnabled(true);
        session.setVersion(0L);
        return toView(liveSessionRepository.save(session));
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<LiveSessionView> findById(UUID sessionId) {
        return liveSessionRepository.findById(sessionId).map(this::toView);
    }

    @Override
    @Transactional(readOnly = true)
    public boolean existsForLesson(UUID lessonId) {
        return liveSessionRepository.existsByLessonId(lessonId);
    }

    /**
     * 라이브 시작(멱등). 세션 강사만. DRAFT/SCHEDULED/OPEN → LIVE, 시계 원점 기록.
     * 이미 LIVE면 그대로(no-op). 종료·취소·실패 상태에서는 다시 시작할 수 없다.
     *
     * 실제 설계는 비동기(STARTING→LIVE, LiveKit room·Egress·STT 조정)지만 그 외부 연동은 후속 —
     * 여기선 상태 전이·시계만 동기로 세운다. room_sid는 실제 방 생성 시 채운다.
     */
    @Transactional
    public LiveSessionView start(UUID sessionId, UUID requesterId) {
        LiveSession s = requireOwned(sessionId, requesterId);
        switch (s.getStatus()) {
            case LIVE -> { /* 멱등: 이미 진행 중 */ }
            case DRAFT, SCHEDULED, OPEN -> {
                OffsetDateTime now = OffsetDateTime.now();
                s.setStatus(LiveSessionStatus.LIVE);
                s.setStartedAt(now);
                s.setClockOriginAt(now);   // 자막·STT 상대시각의 기준점(세션 시계 t0)
                s.setStartedBy(requesterId);
            }
            default -> throw new LiveSessionStateConflictException("이미 종료되었거나 시작할 수 없는 상태입니다.");
        }
        return toView(s);
    }

    /** 라이브 종료(멱등). 세션 강사만. LIVE → ENDED. 이미 ENDED면 그대로. 시작 전이면 종료 불가. */
    @Transactional
    public LiveSessionView end(UUID sessionId, UUID requesterId) {
        LiveSession s = requireOwned(sessionId, requesterId);
        switch (s.getStatus()) {
            case ENDED -> { /* 멱등: 이미 종료됨 */ }
            case LIVE -> {
                s.setStatus(LiveSessionStatus.ENDED);
                s.setEndedAt(OffsetDateTime.now());
            }
            default -> throw new LiveSessionStateConflictException("진행 중이 아니라 종료할 수 없습니다.");
        }
        return toView(s);
    }

    /** 세션을 로드하고 요청자가 그 세션의 강사인지 확인한다. 없으면 404, 강사 아니면 403. */
    private LiveSession requireOwned(UUID sessionId, UUID requesterId) {
        LiveSession s = liveSessionRepository.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
        if (!s.getInstructorId().equals(requesterId)) {
            throw new LiveSessionForbiddenException("이 세션의 강사만 할 수 있습니다.");
        }
        return s;
    }

    private LiveSessionView toView(LiveSession s) {
        return new LiveSessionView(
                s.getId(), s.getLessonId(), s.getInstructorId(), s.getStatus().name(),
                s.getScheduledAt(), s.getRoomSid(), s.getStartedAt(), s.getEndedAt(),
                s.isRecordingEnabled(), s.isCaptionEnabled(), s.isChatEnabled(), s.isAiQnaEnabled(),
                s.getCreatedAt(), s.getUpdatedAt());
    }
}
