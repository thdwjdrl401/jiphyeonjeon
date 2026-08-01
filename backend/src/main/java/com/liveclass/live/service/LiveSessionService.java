package com.liveclass.live.service;

import com.liveclass.live.api.LiveSessionDirectory;
import com.liveclass.live.api.LiveSessionEndedEvent;
import com.liveclass.live.api.LiveSessionManagement;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** 라이브 세션 포트(읽기·쓰기) 구현. 데이터만 담당하고 소유권 검증은 하지 않는다(호출자 책임). */
@Service
public class LiveSessionService implements LiveSessionManagement, LiveSessionDirectory {

    private static final Logger log = LoggerFactory.getLogger(LiveSessionService.class);

    /**
     * "다음 일정"에서 빼는 상태. 종료 계열(ENDED/CANCELLED/FAILED)에 더해 정리 중인 ENDING도 뺀다 —
     * 방을 닫는 중인 세션을 "다음 일정"이라고 보여주면 강사가 아직 시작 전이라고 오해한다.
     */
    private static final Set<LiveSessionStatus> EXCLUDED_FROM_NEXT = Set.of(
            LiveSessionStatus.ENDING, LiveSessionStatus.ENDED,
            LiveSessionStatus.CANCELLED, LiveSessionStatus.FAILED);

    /**
     * 진행 계열 — scheduledAt이 이미 지났어도 "지금/다음 일정"으로 계속 보여준다.
     * 10분 전에 시작해 방송 중인 세션이 목록에서 사라지면 안 되기 때문이다.
     */
    private static final Set<LiveSessionStatus> IN_PROGRESS_STATUSES =
            Set.of(LiveSessionStatus.OPEN, LiveSessionStatus.STARTING, LiveSessionStatus.LIVE);

    private final LiveSessionRepository liveSessionRepository;
    private final LiveRoomControl roomControl;
    private final ApplicationEventPublisher eventPublisher;

    public LiveSessionService(LiveSessionRepository liveSessionRepository, LiveRoomControl roomControl,
                              ApplicationEventPublisher eventPublisher) {
        this.liveSessionRepository = liveSessionRepository;
        this.roomControl = roomControl;
        this.eventPublisher = eventPublisher;
    }

    /** 세션 ID로 결정론적 방 이름(토큰과 동일 규칙). 시작 오케스트레이터·preflight도 같은 규칙을 쓴다. */
    static String roomName(UUID sessionId) {
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
        return liveSessionRepository.findById(sessionId).map(LiveSessionService::toView);
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
        return liveSessionRepository.findByLessonIdIn(lessonIds).stream().map(LiveSessionService::toView).toList();
    }

    /**
     * 커리큘럼별 다음 예정 세션(배치). 쿼리는 페이지당 정확히 1번만 나간다 — 결과가 scheduledAt
     * 오름차순이므로 커리큘럼별 첫 행(putIfAbsent)만 남기면 가장 이른 세션이 된다.
     *
     * <p>기준 시각은 여기서 한 번 찍어 쿼리에 넘긴다(DB의 now() 대신). 한 페이지 안의 모든 행이
     * 같은 시각을 기준으로 판정되고, 테스트에서도 애플리케이션 시계만 보면 된다.
     */
    @Override
    @Transactional(readOnly = true)
    public Map<UUID, LiveSessionView> nextScheduledByCurriculum(Collection<UUID> curriculumIds) {
        if (curriculumIds.isEmpty()) {
            return Map.of();
        }
        OffsetDateTime now = OffsetDateTime.now();
        Map<UUID, LiveSessionView> nextByCurriculum = new LinkedHashMap<>();
        for (LiveSession session : liveSessionRepository.findUpcomingByCurriculumIds(
                curriculumIds, EXCLUDED_FROM_NEXT, IN_PROGRESS_STATUSES, now)) {
            nextByCurriculum.putIfAbsent(session.getCurriculumId(), toView(session));
        }
        return nextByCurriculum;
    }

    /**
     * 라이브 종료(멱등). 세션 강사만. 현재는 한 요청 안에서 {@code LIVE → ENDING → ENDED}를
     * 처리하고 이미 ENDED면 그대로 돌려준다.
     *
     * <p>ADR-0002 §10의 완전한 종료 상태기계는 아직 아니다. 방 삭제 실패를 기록·재시도하는 지속
     * reconciler가 없어 현재 호출은 best-effort이고 응답도 최종 {@code ENDED}다. Phase 7에서는
     * 실패 시 ENDING을 유지하고 room·agent·Egress 정리가 끝난 뒤에만 ENDED를 확정해야 한다.
     */
    @Transactional
    public LiveSessionView end(UUID sessionId, UUID requesterId) {
        LiveSession s = requireOwned(sessionId, requesterId);
        switch (s.getStatus()) {
            case ENDED -> { /* 멱등: 이미 종료됨 */ }
            case LIVE, ENDING -> {
                s.setStatus(LiveSessionStatus.ENDING);   // 신규 토큰·시작 요청을 먼저 막는다.
                closeRoomBestEffort(sessionId);
                s.setStatus(LiveSessionStatus.ENDED);
                s.setEndedAt(OffsetDateTime.now());
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
    LiveSession requireOwned(UUID sessionId, UUID requesterId) {
        LiveSession s = liveSessionRepository.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
        if (!s.getInstructorId().equals(requesterId)) {
            throw new LiveSessionForbiddenException("이 세션의 강사만 할 수 있습니다.");
        }
        return s;
    }

    static LiveSessionView toView(LiveSession s) {
        return new LiveSessionView(
                s.getId(), s.getLessonId(), s.getInstructorId(), s.getStatus().name(),
                s.getScheduledAt(), s.getEntryWindowMinutes(), s.getExpectedDurationMinutes(),
                s.getRoomSid(), s.getStartedAt(), s.getEndedAt(),
                s.isRecordingEnabled(), s.isCaptionEnabled(), s.isChatEnabled(), s.isAiQnaEnabled(),
                s.isAnnotationVisible(),
                s.getCreatedAt(), s.getUpdatedAt());
    }
}
