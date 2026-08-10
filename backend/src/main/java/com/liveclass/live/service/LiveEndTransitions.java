package com.liveclass.live.service;

import com.liveclass.live.api.LiveSessionEndedEvent;
import com.liveclass.live.api.LiveSessionEndingEvent;
import com.liveclass.live.api.LiveSessionView;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.repository.LiveSessionRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

/**
 * 라이브 종료의 짧은 DB 트랜잭션 경계(ADR choinhoo/0003).
 *
 * <p>{@link LiveEndOrchestrator}와 별도 빈으로 둬 외부 Room·Egress 호출이 트랜잭션에 포함되지 않게 한다.
 */
@Service
public class LiveEndTransitions {

    private final LiveSessionRepository liveSessionRepository;
    private final ApplicationEventPublisher eventPublisher;

    public LiveEndTransitions(LiveSessionRepository liveSessionRepository,
                              ApplicationEventPublisher eventPublisher) {
        this.liveSessionRepository = liveSessionRepository;
        this.eventPublisher = eventPublisher;
    }

    /**
     * {@code LIVE → ENDING}. 이미 ENDING이면 수동 재시도를 위해 그대로 반환하고,
     * 이미 ENDED면 외부 제어를 반복하지 않도록 표시한다.
     */
    @Transactional
    public BeginEndResult beginOrReuse(UUID sessionId, UUID requesterId) {
        LiveSession session = requireOwnedForUpdate(sessionId, requesterId);
        return switch (session.getStatus()) {
            case LIVE -> {
                OffsetDateTime occurredAt = OffsetDateTime.now();
                session.setStatus(LiveSessionStatus.ENDING);
                eventPublisher.publishEvent(new LiveSessionEndingEvent(sessionId, occurredAt));
                yield new BeginEndResult(LiveSessionService.toView(session), false);
            }
            case ENDING -> new BeginEndResult(LiveSessionService.toView(session), false);
            case ENDED -> new BeginEndResult(LiveSessionService.toView(session), true);
            default -> throw new LiveSessionStateConflictException("진행 중이 아니라 종료할 수 없습니다.");
        };
    }

    /** Room·Egress 제어가 끝난 뒤 {@code ENDING → ENDED}를 확정한다. */
    @Transactional
    public LiveSessionView complete(UUID sessionId, UUID requesterId) {
        return completeLocked(requireOwnedForUpdate(sessionId, requesterId), sessionId);
    }

    /**
     * 시스템이 여는 종료. <b>요청자가 없다</b> — LiveKit이 방을 닫았거나(webhook) 방이 오래 비어
     * 있을 때(재조정) 쓴다.
     *
     * <p>사람이 부르는 {@link #beginOrReuse}와 <b>일부러 갈라 둔다</b>. requesterId 자리에
     * instructorId를 넣어 우회하면 소유권 검사가 형식만 남고, 어느 종료가 시스템이 한 일인지
     * 로그에서 구분되지 않는다.
     *
     * <p>손댈 상태가 아니면 {@link Optional#empty()}다 — 스케줄러는 DRAFT 세션을 만났다고
     * 예외를 던질 자리가 아니다. 상태 판정을 행 잠금 안에서 하므로 후보를 고른 뒤 강사가 먼저
     * 종료해도 겹치지 않는다.
     */
    @Transactional
    public Optional<BeginEndResult> beginBySystem(UUID sessionId) {
        LiveSession session = liveSessionRepository.findByIdForUpdate(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
        return switch (session.getStatus()) {
            case LIVE -> {
                OffsetDateTime occurredAt = OffsetDateTime.now();
                session.setStatus(LiveSessionStatus.ENDING);
                eventPublisher.publishEvent(new LiveSessionEndingEvent(sessionId, occurredAt));
                yield Optional.of(new BeginEndResult(LiveSessionService.toView(session), false));
            }
            // 강사가 종료를 눌렀다가 외부 제어에서 멈춘 세션. 마저 끝내 준다.
            case ENDING -> Optional.of(new BeginEndResult(LiveSessionService.toView(session), false));
            case ENDED -> Optional.of(new BeginEndResult(LiveSessionService.toView(session), true));
            /*
             * STARTING은 건드리지 않는다. 시작 게이트가 도는 중이고 그쪽에 lease와 재조정이 따로
             * 있다(LiveStartReconciler) — 두 재조정이 같은 세션을 반대 방향으로 밀면 안 된다.
             */
            default -> Optional.empty();
        };
    }

    /** 시스템 경로의 {@code ENDING → ENDED} 확정. */
    @Transactional
    public LiveSessionView completeBySystem(UUID sessionId) {
        LiveSession session = liveSessionRepository.findByIdForUpdate(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
        return completeLocked(session, sessionId);
    }

    private LiveSessionView completeLocked(LiveSession session, UUID sessionId) {
        if (session.getStatus() == LiveSessionStatus.ENDED) {
            return LiveSessionService.toView(session);
        }
        if (session.getStatus() != LiveSessionStatus.ENDING) {
            throw new LiveSessionStateConflictException("종료 처리 중인 세션만 종료를 확정할 수 있습니다.");
        }

        OffsetDateTime endedAt = OffsetDateTime.now();
        session.setStatus(LiveSessionStatus.ENDED);
        session.setEndedAt(endedAt);
        eventPublisher.publishEvent(new LiveSessionEndedEvent(sessionId, endedAt));
        return LiveSessionService.toView(session);
    }

    private LiveSession requireOwnedForUpdate(UUID sessionId, UUID requesterId) {
        LiveSession session = liveSessionRepository.findByIdForUpdate(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
        if (!session.getInstructorId().equals(requesterId)) {
            throw new LiveSessionForbiddenException("이 세션의 강사만 할 수 있습니다.");
        }
        return session;
    }

    public record BeginEndResult(LiveSessionView session, boolean alreadyEnded) {
    }
}
