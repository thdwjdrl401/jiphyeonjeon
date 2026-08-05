package com.liveclass.live.service;

import com.liveclass.live.api.LiveSessionStartedEvent;
import com.liveclass.live.api.LiveSessionStartingEvent;
import com.liveclass.live.domain.LiveAgentJob;
import com.liveclass.live.domain.LiveAgentJobStatus;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.domain.LiveStartAttempt;
import com.liveclass.live.domain.LiveStartAttemptStatus;
import com.liveclass.live.domain.LiveStartStep;
import com.liveclass.live.repository.LiveAgentJobRepository;
import com.liveclass.live.repository.LiveSessionRepository;
import com.liveclass.live.repository.LiveStartAttemptRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

/**
 * 게이트 실행 중간중간 필요한 <b>짧은 트랜잭션</b>들(ADR-0002 §3 "외부 I/O 동안 DB 트랜잭션을 열어 두지 않는다").
 *
 * <p>{@link LiveStartOrchestrator}와 별도 빈인 이유는 프록시 때문이다 — 같은 빈 안에서 부르면
 * {@code @Transactional}이 적용되지 않아 LIVE 전환이 조용히 커밋되지 않는다.
 */
@Service
public class LiveStartTransitions {

    private static final Logger log = LoggerFactory.getLogger(LiveStartTransitions.class);
    private static final String CORRELATION_PREFIX = "start-";

    private final LiveSessionRepository liveSessionRepository;
    private final LiveStartAttemptRepository attemptRepository;
    private final LiveAgentJobRepository agentJobRepository;
    private final ApplicationEventPublisher eventPublisher;

    public LiveStartTransitions(LiveSessionRepository liveSessionRepository,
                                LiveStartAttemptRepository attemptRepository,
                                LiveAgentJobRepository agentJobRepository,
                                ApplicationEventPublisher eventPublisher) {
        this.liveSessionRepository = liveSessionRepository;
        this.attemptRepository = attemptRepository;
        this.agentJobRepository = agentJobRepository;
        this.eventPublisher = eventPublisher;
    }

    /**
     * preflight가 통과한 시작 요청을 한 짧은 트랜잭션에서 접수한다. 세션 행 잠금이 동시 클릭을
     * 직렬화하므로 두 요청 모두 성공하더라도 active attempt와 operation은 하나뿐이다.
     */
    @Transactional
    public BeginStartResult beginOrReuse(UUID sessionId, UUID requesterId) {
        LiveSession session = liveSessionRepository.findByIdForUpdate(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
        if (!session.getInstructorId().equals(requesterId)) {
            throw new LiveSessionForbiddenException("이 세션의 강사만 할 수 있습니다.");
        }
        if (session.getStatus() == LiveSessionStatus.LIVE) {
            UUID operationId = attemptRepository.findFirstByLiveSessionIdOrderByCreatedAtDesc(sessionId)
                    .map(LiveStartAttempt::getOperationId)
                    .orElse(null);
            return new BeginStartResult(operationId, sessionId, LiveSessionStatus.LIVE.name());
        }
        if (session.getStatus() == LiveSessionStatus.STARTING) {
            UUID operationId = attemptRepository
                    .findByLiveSessionIdAndStatus(sessionId, LiveStartAttemptStatus.IN_PROGRESS)
                    .map(LiveStartAttempt::getOperationId)
                    .orElseThrow(() -> new LiveSessionStateConflictException(
                            "STARTING 세션의 진행 중 시작 시도를 찾을 수 없습니다."));
            return new BeginStartResult(operationId, sessionId, LiveSessionStatus.STARTING.name());
        }
        if (session.getStatus() != LiveSessionStatus.DRAFT
                && session.getStatus() != LiveSessionStatus.SCHEDULED
                && session.getStatus() != LiveSessionStatus.OPEN) {
            throw new LiveSessionStateConflictException("이미 종료되었거나 시작할 수 없는 상태입니다.");
        }
        if (!session.isRecordingEnabled()) {
            throw new LiveSessionStateConflictException("HLS 송출을 위해 녹화가 활성화된 세션만 시작할 수 있습니다.");
        }
        if (session.getRoomSid() == null || session.getRoomSid().isBlank()) {
            throw new LiveSessionStateConflictException("preflight 방 준비가 완료되지 않았습니다.");
        }

        session.setStatus(LiveSessionStatus.STARTING);
        session.setStartedBy(session.getInstructorId());

        UUID operationId = UUID.randomUUID();
        LiveStartAttempt attempt = new LiveStartAttempt();
        attempt.setLiveSessionId(sessionId);
        attempt.setOperationId(operationId);
        attempt.setCorrelationId(CORRELATION_PREFIX + operationId);
        attempt.setStatus(LiveStartAttemptStatus.IN_PROGRESS);
        attempt.setStep(LiveStartStep.ACCEPTED);
        attempt.setAttemptCount(0);
        attempt.setNextAttemptAt(OffsetDateTime.now());
        attemptRepository.save(attempt);

        eventPublisher.publishEvent(new LiveSessionStartingEvent(
                sessionId, session.getLessonId(), LiveSessionService.roomName(sessionId),
                attempt.getId(), attempt.getCorrelationId(),
                session.isRecordingEnabled(), session.isCaptionEnabled()));
        log.info("라이브 시작 접수 session={} operationId={}", sessionId, operationId);
        return new BeginStartResult(operationId, sessionId, LiveSessionStatus.STARTING.name());
    }

    /** 세션의 진행 중 시작 시도 ID. 실제 독점 claim은 {@link #claim}이 row lock으로 수행한다. */
    @Transactional(readOnly = true)
    public Optional<UUID> findPendingAttemptId(UUID sessionId) {
        return attemptRepository.findByLiveSessionIdAndStatus(sessionId, LiveStartAttemptStatus.IN_PROGRESS)
                .map(LiveStartAttempt::getId);
    }

    /**
     * 즉시 trigger와 scheduled reconciler 중 하나만 attempt를 진행하게 DB lease를 획득한다.
     * Spring이 중간에 죽으면 lease 만료 뒤 다른 인스턴스가 같은 attempt를 다시 실행한다.
     */
    @Transactional
    public Optional<LiveSessionStartingEvent> claim(UUID attemptId, String owner, Duration leaseDuration) {
        OffsetDateTime now = OffsetDateTime.now();
        LiveStartAttempt attempt = attemptRepository.findByIdForUpdate(attemptId).orElse(null);
        if (attempt == null || attempt.getStatus() != LiveStartAttemptStatus.IN_PROGRESS) {
            return Optional.empty();
        }
        if (attempt.getLeaseUntil() != null && attempt.getLeaseUntil().isAfter(now)
                && !owner.equals(attempt.getLeaseOwner())) {
            return Optional.empty();
        }
        LiveSession session = liveSessionRepository.findById(attempt.getLiveSessionId()).orElse(null);
        if (session == null || session.getStatus() != LiveSessionStatus.STARTING) {
            return Optional.empty();
        }

        attempt.setLeaseOwner(owner);
        attempt.setLeaseUntil(now.plus(leaseDuration));
        attempt.setAttemptCount(attempt.getAttemptCount() + 1);
        attempt.setNextAttemptAt(now);

        return Optional.of(new LiveSessionStartingEvent(
                session.getId(), session.getLessonId(), LiveSessionService.roomName(session.getId()),
                attempt.getId(), attempt.getCorrelationId(),
                session.isRecordingEnabled(), session.isCaptionEnabled()));
    }

    /** 실행 단계와 lease 만료를 함께 갱신한다. 긴 외부 I/O 사이에도 현재 진행 위치가 DB에 남는다. */
    @Transactional
    public boolean advance(UUID attemptId, LiveStartStep step, String owner, Duration leaseDuration) {
        return attemptRepository.findById(attemptId)
                .filter(attempt -> attempt.getStatus() == LiveStartAttemptStatus.IN_PROGRESS)
                .filter(attempt -> owner.equals(attempt.getLeaseOwner()))
                .map(attempt -> {
                    attempt.setStep(step);
                    attempt.setLeaseUntil(OffsetDateTime.now().plus(leaseDuration));
                    return true;
                })
                .orElse(false);
    }

    /** Phase 4a AgentDispatch ID와 exact metadata를 Egress 전에 영속한다. */
    @Transactional
    public boolean recordAssumedRunningAgent(LiveSessionStartingEvent event, String dispatchId,
                                             String agentName, String metadataJson, String owner) {
        if (!ownsClaim(event.attemptId(), event.sessionId(), owner)) {
            return false;
        }
        LiveAgentJob job = agentJobRepository.findByLiveStartAttemptId(event.attemptId())
                .orElseGet(LiveAgentJob::new);
        job.setLiveStartAttemptId(event.attemptId());
        job.setLiveSessionId(event.sessionId());
        job.setDispatchId(dispatchId);
        job.setAgentName(agentName);
        job.setMetadataJson(metadataJson);
        job.setStatus(LiveAgentJobStatus.ASSUMED_RUNNING);
        job.setFailureCode(null);
        agentJobRepository.save(job);
        return true;
    }

    /** 자막을 명시적으로 끈 세션도 STT가 빠진 이유를 영속 상태로 남긴다. */
    @Transactional
    public boolean recordDisabledAgent(LiveSessionStartingEvent event, String agentName,
                                       String metadataJson, String owner) {
        if (!ownsClaim(event.attemptId(), event.sessionId(), owner)) {
            return false;
        }
        LiveAgentJob job = agentJobRepository.findByLiveStartAttemptId(event.attemptId())
                .orElseGet(LiveAgentJob::new);
        job.setLiveStartAttemptId(event.attemptId());
        job.setLiveSessionId(event.sessionId());
        job.setAgentName(agentName);
        job.setMetadataJson(metadataJson);
        job.setStatus(LiveAgentJobStatus.DISABLED);
        agentJobRepository.save(job);
        return true;
    }

    @Transactional(readOnly = true)
    public Optional<String> findDispatchId(UUID attemptId) {
        return agentJobRepository.findByLiveStartAttemptId(attemptId)
                .map(LiveAgentJob::getDispatchId)
                .filter(id -> !id.isBlank());
    }

    @Transactional
    public void markAgentDeleted(UUID attemptId, String failureCode) {
        agentJobRepository.findByLiveStartAttemptId(attemptId).ifPresent(job -> {
            job.setStatus(LiveAgentJobStatus.DELETED);
            job.setFailureCode(failureCode);
        });
    }

    /** Gate S3까지 통과한 뒤 세션·attempt를 한 트랜잭션에서 함께 확정한다(§7). */
    @Transactional
    public void promoteToLive(LiveSessionStartingEvent event, String owner) {
        LiveStartAttempt attempt = attemptRepository.findByIdForUpdate(event.attemptId()).orElse(null);
        if (attempt == null
                || attempt.getStatus() != LiveStartAttemptStatus.IN_PROGRESS
                || !attempt.getLiveSessionId().equals(event.sessionId())
                || !owner.equals(attempt.getLeaseOwner())) {
            return;   // 늦게 끝난 이전 실행이 새 attempt를 성공시키지 못하게 fencing.
        }
        LiveSession session = liveSessionRepository.findById(event.sessionId()).orElse(null);
        if (session == null || session.getStatus() != LiveSessionStatus.STARTING) {
            return;   // 그 사이 취소·종료됐다면 되살리지 않는다.
        }
        OffsetDateTime now = OffsetDateTime.now();
        session.setStatus(LiveSessionStatus.LIVE);
        // startedAt·clockOriginAt은 STARTING 진입이 아니라 여기서 찍는다 — 학생이 실제로 볼 수 있게 된
        // 시각이 세션 시계의 원점이다(§7). Egress가 LIVE 직전에 만든 짧은 pre-roll과의 시간축 보정은 후속 계약.
        session.setStartedAt(now);
        session.setClockOriginAt(now);
        attempt.setStatus(LiveStartAttemptStatus.SUCCEEDED);
        attempt.setStep(LiveStartStep.LIVE);
        attempt.setCompletedAt(now);
        attempt.setLeaseOwner(null);
        attempt.setLeaseUntil(null);

        eventPublisher.publishEvent(new LiveSessionStartedEvent(
                event.sessionId(), event.lessonId(), event.roomName(), event.recordingEnabled(), now));
        log.info("라이브 시작 완료 session={} attempt={}", event.sessionId(), event.attemptId());
    }

    /**
     * 시작 실패 기록. 세션은 terminal {@code FAILED}가 아니라 {@code OPEN}으로 되돌린다(§6) —
     * 일시적인 STT·Egress 실패로 세션을 못 쓰게 만들면 강사가 재시도할 수 없다.
     */
    @Transactional
    public void markFailed(UUID attemptId, UUID sessionId, String owner, String code, String message) {
        LiveStartAttempt attempt = attemptRepository.findByIdForUpdate(attemptId).orElse(null);
        if (attempt == null
                || attempt.getStatus() != LiveStartAttemptStatus.IN_PROGRESS
                || !attempt.getLiveSessionId().equals(sessionId)
                || !owner.equals(attempt.getLeaseOwner())) {
            return;   // stale attempt는 현재 세션/외부 자원을 건드리지 않는다.
        }
        attempt.setStatus(LiveStartAttemptStatus.FAILED);
        attempt.setStep(LiveStartStep.FAILED);
        attempt.setFailureCode(code);
        attempt.setFailureMessage(message);
        attempt.setCompletedAt(OffsetDateTime.now());
        attempt.setLeaseOwner(null);
        attempt.setLeaseUntil(null);
        // 즉시 flush: 강사가 곧바로 재시도하면 새 attempt가 insert되는데, 이 UPDATE가 뒤로 밀리면
        // "세션당 IN_PROGRESS 하나" 부분 유니크 인덱스에 걸린다(Hibernate는 insert를 update보다 먼저 낸다).
        attemptRepository.saveAndFlush(attempt);
        liveSessionRepository.findById(sessionId)
                .filter(session -> session.getStatus() == LiveSessionStatus.STARTING)
                .ifPresent(session -> session.setStatus(LiveSessionStatus.OPEN));
    }

    /** Gate S3①이 볼 소유 강사 ID. 세션이 사라졌으면 empty. */
    @Transactional(readOnly = true)
    public Optional<UUID> findInstructorId(UUID sessionId) {
        return liveSessionRepository.findById(sessionId).map(LiveSession::getInstructorId);
    }

    @Transactional(readOnly = true)
    public boolean ownsClaim(UUID attemptId, UUID sessionId, String owner) {
        return attemptRepository.findById(attemptId)
                .filter(attempt -> attempt.getStatus() == LiveStartAttemptStatus.IN_PROGRESS)
                .filter(attempt -> attempt.getLiveSessionId().equals(sessionId))
                .filter(attempt -> owner.equals(attempt.getLeaseOwner()))
                .filter(attempt -> attempt.getLeaseUntil() != null
                        && attempt.getLeaseUntil().isAfter(OffsetDateTime.now()))
                .isPresent();
    }

    public record BeginStartResult(UUID operationId, UUID sessionId, String status) {
    }
}
