package com.liveclass.live.service;

import com.liveclass.live.api.LiveSessionDirectory;
import com.liveclass.live.api.LiveSessionEndedEvent;
import com.liveclass.live.api.LiveSessionManagement;
import com.liveclass.live.api.LiveSessionStartedEvent;
import com.liveclass.live.api.LiveSessionView;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.repository.LiveSessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 라이브 세션 포트(읽기·쓰기) 구현. 데이터만 담당하고 소유권 검증은 하지 않는다(호출자 책임). */
@Service
public class LiveSessionService implements LiveSessionManagement, LiveSessionDirectory {

    private static final Logger log = LoggerFactory.getLogger(LiveSessionService.class);

    private final LiveSessionRepository liveSessionRepository;
    private final LiveRoomControl roomControl;
    private final ApplicationEventPublisher eventPublisher;

    public LiveSessionService(LiveSessionRepository liveSessionRepository, LiveRoomControl roomControl,
                              ApplicationEventPublisher eventPublisher) {
        this.liveSessionRepository = liveSessionRepository;
        this.roomControl = roomControl;
        this.eventPublisher = eventPublisher;
    }

    /** 세션 ID로 결정론적 방 이름(토큰과 동일 규칙). */
    private static String roomName(UUID sessionId) {
        return "session-" + sessionId;
    }

    @Override
    @Transactional
    public LiveSessionView create(UUID lessonId, UUID curriculumId, UUID instructorId, OffsetDateTime scheduledAt) {
        LiveSession session = new LiveSession();
        session.setLessonId(lessonId);
        session.setCurriculumId(curriculumId);   // 접근 게이팅용 비정규화
        session.setInstructorId(instructorId);
        session.setScheduledAt(scheduledAt);
        session.setStatus(scheduledAt != null ? LiveSessionStatus.SCHEDULED : LiveSessionStatus.DRAFT);
        // 세션 기능 플래그는 DDL 기본값(전부 true)과 맞춘다. 세부 토글은 후속.
        session.setRecordingEnabled(true);
        session.setCaptionEnabled(true);
        session.setChatEnabled(true);
        session.setAiQnaEnabled(true);
        // version은 @Version이라 Hibernate가 관리한다(수동 초기화 불필요).
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

    @Override
    @Transactional(readOnly = true)
    public List<LiveSessionView> findByLessons(Collection<UUID> lessonIds) {
        if (lessonIds.isEmpty()) {
            return List.of();   // 빈 IN 절로 쿼리를 쏘지 않는다.
        }
        return liveSessionRepository.findByLessonIdIn(lessonIds).stream().map(this::toView).toList();
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
                // 커밋 후 부가 처리(녹화 등)를 트리거. best-effort라 세션 시작을 막지 않는다.
                eventPublisher.publishEvent(new LiveSessionStartedEvent(
                        s.getId(), s.getLessonId(), roomName(s.getId()), s.isRecordingEnabled()));
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
                // DB 종료가 진실의 원천. 실제 방 닫기는 정리 작업이라 실패해도 종료를 되돌리지 않는다(best-effort).
                closeRoomBestEffort(sessionId);
                // 커밋 후 녹화 중지 등 정리 처리를 트리거.
                eventPublisher.publishEvent(new LiveSessionEndedEvent(sessionId));
            }
            default -> throw new LiveSessionStateConflictException("진행 중이 아니라 종료할 수 없습니다.");
        }
        return toView(s);
    }

    /** 방 참여자 목록(강사). 실제 LiveKit 서버 조회. */
    @Transactional(readOnly = true)
    public List<LiveRoomControl.RoomParticipant> listParticipants(UUID sessionId, UUID requesterId) {
        requireOwned(sessionId, requesterId);
        return roomControl.listParticipants(roomName(sessionId));
    }

    /** 참여자 강퇴(강사). 실제 LiveKit 서버에 removeParticipant 명령. */
    @Transactional(readOnly = true)
    public void removeParticipant(UUID sessionId, UUID requesterId, String identity) {
        requireOwned(sessionId, requesterId);
        roomControl.removeParticipant(roomName(sessionId), identity);
        log.info("참여자 강퇴 sessionId={} identity={}", sessionId, identity);
    }

    private void closeRoomBestEffort(UUID sessionId) {
        try {
            roomControl.closeRoom(roomName(sessionId));
        } catch (RuntimeException e) {
            log.warn("종료 시 방 닫기 실패(무시) sessionId={} : {}", sessionId, e.getMessage());
        }
    }

    /** 일정 수정(강사). 시작 전(DRAFT/SCHEDULED/OPEN)에만 가능. null은 "변경 안 함". 상태 자동 전이는 없다. */
    @Transactional
    public LiveSessionView updateSchedule(UUID sessionId, UUID requesterId,
                                          OffsetDateTime scheduledAt,
                                          Integer entryWindowMinutes,
                                          Integer expectedDurationMinutes) {
        LiveSession s = requireOwned(sessionId, requesterId);
        requireNotStarted(s, "시작된 세션은 일정을 수정할 수 없습니다.");
        if (scheduledAt != null) {
            s.setScheduledAt(scheduledAt);
        }
        if (entryWindowMinutes != null) {
            s.setEntryWindowMinutes(entryWindowMinutes);
        }
        if (expectedDurationMinutes != null) {
            s.setExpectedDurationMinutes(expectedDurationMinutes);
        }
        return toView(s);
    }

    /** 시작 전 취소(강사). DRAFT/SCHEDULED/OPEN → CANCELLED. 이미 CANCELLED면 그대로(멱등). 시작·종료된 건 취소 불가. */
    @Transactional
    public LiveSessionView cancel(UUID sessionId, UUID requesterId) {
        LiveSession s = requireOwned(sessionId, requesterId);
        switch (s.getStatus()) {
            case CANCELLED -> { /* 멱등 */ }
            case DRAFT, SCHEDULED, OPEN -> s.setStatus(LiveSessionStatus.CANCELLED);
            default -> throw new LiveSessionStateConflictException("이미 시작·종료된 세션은 취소할 수 없습니다.");
        }
        return toView(s);
    }

    /** 아직 시작 전(DRAFT/SCHEDULED/OPEN)이 아니면 상태 충돌. */
    private void requireNotStarted(LiveSession s, String message) {
        switch (s.getStatus()) {
            case DRAFT, SCHEDULED, OPEN -> { /* ok */ }
            default -> throw new LiveSessionStateConflictException(message);
        }
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
                s.getScheduledAt(), s.getEntryWindowMinutes(), s.getExpectedDurationMinutes(),
                s.getRoomSid(), s.getStartedAt(), s.getEndedAt(),
                s.isRecordingEnabled(), s.isCaptionEnabled(), s.isChatEnabled(), s.isAiQnaEnabled(),
                s.getCreatedAt(), s.getUpdatedAt());
    }
}
