package com.liveclass.live.service;

import com.liveclass.live.api.LiveRecordingControl;
import com.liveclass.live.api.LiveSessionStartingEvent;
import com.liveclass.live.api.LiveSessionView;
import com.liveclass.live.config.LiveKitProperties;
import com.liveclass.live.config.LiveStartProperties;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.domain.LiveStartAttempt;
import com.liveclass.live.domain.LiveStartStep;
import com.liveclass.live.repository.LiveStartAttemptRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 라이브 시작 오케스트레이션(ADR-0002 §2·§4·§5-1·§7).
 *
 * <p>{@code /start}는 긴 외부 준비를 HTTP 요청이나 DB 트랜잭션 안에서 기다리지 않는다. 짧은 트랜잭션에서
 * 세션을 {@code STARTING}으로 바꾸고 {@link LiveStartAttempt}를 남긴 뒤 {@code 202}를 돌려주고,
 * 실제 게이트({@link #runStartGates})는 커밋 후 {@link LiveStartGateExecutor}가 별도 스레드에서 진행한다.
 *
 * <pre>
 * STT dispatch(필수, readiness만 임시 가정, §5-1) → Egress Gate A(시작)
 * → Gate B~C(ACTIVE + manifest·첫 세그먼트)
 * → Gate S3①(강사 마이크 재검증, §7) → LIVE
 * </pre>
 */
@Service
public class LiveStartOrchestrator {

    private static final Logger log = LoggerFactory.getLogger(LiveStartOrchestrator.class);

    private final LiveStartAttemptRepository attemptRepository;
    private final LiveStartTransitions transitions;
    private final LiveSessionService liveSessionService;
    private final LivePreflightService preflightService;
    private final AgentDispatchControl agentDispatchControl;
    private final LiveRecordingControl recordingControl;
    private final LiveKitProperties liveKitProperties;
    private final LiveStartProperties startProperties;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public LiveStartOrchestrator(LiveStartAttemptRepository attemptRepository,
                                 LiveStartTransitions transitions,
                                 LiveSessionService liveSessionService,
                                 LivePreflightService preflightService,
                                 AgentDispatchControl agentDispatchControl,
                                 LiveRecordingControl recordingControl,
                                 LiveKitProperties liveKitProperties,
                                 LiveStartProperties startProperties) {
        this.attemptRepository = attemptRepository;
        this.transitions = transitions;
        this.liveSessionService = liveSessionService;
        this.preflightService = preflightService;
        this.agentDispatchControl = agentDispatchControl;
        this.recordingControl = recordingControl;
        this.liveKitProperties = liveKitProperties;
        this.startProperties = startProperties;
    }

    // ---- /start ----

    /**
     * 시작 요청 접수(멱등). 이미 {@code LIVE}면 성공 상태를, 이미 {@code STARTING}이면 진행 중인 같은
     * attempt를 돌려준다 — 재클릭이 Dispatch·Egress를 새로 만들지 않게 하는 지점이다.
     * 세션당 진행 중 attempt가 하나뿐이라는 최종 보장은 DB의 부분 유니크 인덱스가 한다.
     */
    public StartOperation start(UUID sessionId, UUID requesterId) {
        LiveSession session = liveSessionService.requireOwned(sessionId, requesterId);
        if (session.getStatus() == LiveSessionStatus.LIVE || session.getStatus() == LiveSessionStatus.STARTING) {
            return toStartOperation(transitions.beginOrReuse(sessionId, requesterId));
        }
        return switch (session.getStatus()) {
            case DRAFT, SCHEDULED, OPEN -> {
                if (!session.isRecordingEnabled()) {
                    throw new LiveSessionStateConflictException(
                            "HLS 송출을 위해 녹화가 활성화된 세션만 시작할 수 있습니다.");
                }
                // 정상 FE는 preflight 진입 때 이미 준비한다. 오래된 클라이언트/새로고침 경로에서는
                // roomSid가 비어 있을 때만 멱등 보완하되, 외부 LiveKit 호출은 DB 트랜잭션 밖에서 수행한다.
                if (session.getRoomSid() == null || session.getRoomSid().isBlank()) {
                    preflightService.prepareRoom(sessionId, requesterId);
                }
                // 마이크는 보지 않는다 — 없으면 무음일 뿐 실패가 아니다(ADR-0099). 강사가 방에
                // 들어와 있는지와 마이크가 겹치지 않는지만 본다.
                if (!preflightService.checkOwned(sessionId, requesterId).ready()) {
                    throw new LiveSessionStateConflictException(
                            "강사 연결이 확인된 뒤 라이브를 시작할 수 있습니다.");
                }
                yield toStartOperation(transitions.beginOrReuse(sessionId, requesterId));
            }
            default -> throw new LiveSessionStateConflictException("이미 종료되었거나 시작할 수 없는 상태입니다.");
        };
    }

    private StartOperation toStartOperation(LiveStartTransitions.BeginStartResult result) {
        return new StartOperation(result.operationId(), result.sessionId(), result.status());
    }

    // ---- 상태 폴링 ----

    /** FE가 STARTING 동안 관찰하는 시작 상태. 세션 뷰를 함께 내려 별도 세션 재조회가 필요 없게 한다. */
    @Transactional(readOnly = true)
    public StartStatus status(UUID sessionId, UUID requesterId, UUID operationId) {
        LiveSession session = liveSessionService.requireOwned(sessionId, requesterId);
        LiveStartAttempt attempt = (operationId != null
                ? attemptRepository.findByOperationId(operationId)
                : attemptRepository.findFirstByLiveSessionIdOrderByCreatedAtDesc(sessionId))
                .filter(a -> a.getLiveSessionId().equals(sessionId))
                .orElse(null);
        if (attempt == null) {
            return new StartStatus(null, null, null, null, null, LiveSessionService.toView(session));
        }
        return new StartStatus(attempt.getOperationId(), attempt.getStatus().name(),
                attempt.getStep() != null ? attempt.getStep().name() : null,
                attempt.getFailureCode(), attempt.getFailureMessage(), LiveSessionService.toView(session));
    }

    // ---- 게이트 실행(커밋 후, 별도 스레드) ----

    /**
     * 세션의 진행 중 attempt를 찾아 게이트를 실행한다. 진행 중 attempt가 없으면 아무것도 하지 않는다.
     * 이벤트 없이 게이트를 다시 돌려야 할 때(테스트·수동 복구)의 진입점이다.
     */
    public void runStartGates(UUID sessionId) {
        transitions.findPendingAttemptId(sessionId)
                .ifPresentOrElse(this::runStartGatesByAttempt,
                        () -> log.debug("진행 중인 시작 시도 없음 — 게이트 건너뜀 session={}", sessionId));
    }

    /** reconciler가 attempt ID를 직접 넘기는 진입점. */
    public void runStartGatesByAttempt(UUID attemptId) {
        String executionOwner = "start-exec-" + UUID.randomUUID();
        transitions.claim(attemptId, executionOwner, startProperties.start().executionLease())
                .ifPresent(event -> runClaimedStartGates(event, executionOwner));
    }

    /**
     * ADR §5-1·§4·§7의 게이트를 순서대로 수행한다. 어느 단계든 실패하면 세션을 {@code OPEN}으로 되돌리고
     * 생성된 외부 자원을 멱등 정리한다 — 강사가 곧바로 재시도할 수 있어야 하기 때문이다.
     */
    public void runStartGates(LiveSessionStartingEvent event) {
        String executionOwner = "start-exec-" + UUID.randomUUID();
        transitions.claim(event.attemptId(), executionOwner, startProperties.start().executionLease())
                .ifPresent(claimed -> runClaimedStartGates(claimed, executionOwner));
    }

    private void runClaimedStartGates(LiveSessionStartingEvent event, String executionOwner) {
        UUID sessionId = event.sessionId();
        String dispatchId = null;
        boolean egressStarted = false;
        try {
            if (!event.recordingEnabled()) {
                failStart(event, executionOwner, null, false, "RECORDING_REQUIRED",
                        "HLS 송출을 위해 녹화가 활성화되어야 합니다.");
                return;
            }

            String metadataJson = dispatchMetadataJson(event);
            if (event.captionEnabled()) {
                if (!startProperties.stt().assumeReadyEnabled()) {
                    // Phase 4b가 배포되기 전에 false를 켜도 readiness를 조용히 우회하지 않는다.
                    failStart(event, executionOwner, null, false, "STT_READINESS_GATE_UNAVAILABLE",
                            "STT readiness gate가 아직 배포되지 않았습니다.");
                    return;
                }
                dispatchId = ensureDispatch(event, metadataJson).orElse(null);
                if (dispatchId == null) {
                    failStart(event, executionOwner, null, false, "STT_DISPATCH_FAILED",
                            "실시간 자막 작업을 배정하지 못했습니다.");
                    return;
                }
                if (!transitions.recordAssumedRunningAgent(
                        event, dispatchId, liveKitProperties.agentName(), metadataJson, executionOwner)) {
                    return;
                }
            } else {
                if (!transitions.recordDisabledAgent(
                        event, liveKitProperties.agentName(), metadataJson, executionOwner)) {
                    return;
                }
            }
            if (!transitions.advance(event.attemptId(), LiveStartStep.STT_DISPATCHED,
                    executionOwner, startProperties.start().executionLease())) {
                return;
            }

            // 2. Egress Gate A — API 수락.
            if (!transitions.advance(event.attemptId(), LiveStartStep.EGRESS_STARTING,
                    executionOwner, startProperties.start().executionLease())) {
                return;
            }
            if (!recordingControl.startRecording(sessionId, event.lessonId(), event.roomName())) {
                failStart(event, executionOwner, dispatchId, false,
                        "EGRESS_START_FAILED", "녹화를 시작하지 못했습니다.");
                return;
            }
            egressStarted = true;
            // 3. Egress Gate B~C — 프로세스 활성 + 학생 재생 가능(manifest + 첫 세그먼트).
            String egressFailure = awaitEgressReady(sessionId);
            if (egressFailure != null) {
                failStart(event, executionOwner, dispatchId, true,
                        egressFailure, "녹화 준비가 끝나지 않았습니다.");
                return;
            }
            if (!transitions.advance(event.attemptId(), LiveStartStep.EGRESS_READY,
                    executionOwner, startProperties.start().executionLease())) {
                return;
            }

            // 4. Gate S3① — 강사가 아직 방에 있는지 재검증. STT 플래그와 무관하게 항상 수행한다(§7).
            //    STARTING이 수십 초 걸리는 동안 강사 연결이 끊겨도 여기서 잡지 않으면 빈 방이 LIVE가 된다.
            //    막으려는 것은 <b>빈 방</b>이지 무음이 아니므로 마이크 유무는 보지 않는다(ADR-0099).
            if (!transitions.advance(event.attemptId(), LiveStartStep.PUBLISHER_RECHECK,
                    executionOwner, startProperties.start().executionLease())) {
                return;
            }
            if (!instructorStillConnected(sessionId)) {
                failStart(event, executionOwner, dispatchId, true, "INSTRUCTOR_NOT_PUBLISHING",
                        "강사 연결이 확인되지 않습니다. 다시 시작해 주세요.");
                return;
            }

            transitions.promoteToLive(event, executionOwner);
        } catch (RuntimeException e) {
            log.warn("시작 게이트 실행 실패 session={}: {}", sessionId, e.getMessage(), e);
            failStart(event, executionOwner, dispatchId, egressStarted,
                    "START_FAILED", "라이브 시작에 실패했습니다.");
        }
    }

    private Optional<String> ensureDispatch(LiveSessionStartingEvent event, String metadataJson) {
        return agentDispatchControl.ensureDispatch(
                event.roomName(), liveKitProperties.agentName(), metadataJson);
    }

    /**
     * Python {@code JobMetadata}와 같은 4개 필드만, 같은 순서로 직렬화한다. 미지 필드가 하나라도 있으면
     * agent가 job을 거부한다(ai/realtime-agent/app/jobs/metadata.py).
     */
    String dispatchMetadataJson(LiveSessionStartingEvent event) {
        Map<String, String> metadata = new LinkedHashMap<>();
        metadata.put("contractVersion", "1");
        metadata.put("sessionId", event.sessionId().toString());
        metadata.put("lessonId", event.lessonId().toString());
        metadata.put("correlationId", event.correlationId());
        return jsonMapper.writeValueAsString(metadata);
    }

    /**
     * Gate B~C bounded polling. 단일 poll 실패로 실패를 확정하지 않고, 명시적 terminal 상태와 timeout만
     * 실패로 접는다(§4).
     *
     * @return 실패 code, 준비되면 null
     */
    private String awaitEgressReady(UUID sessionId) {
        Duration timeout = startProperties.start().egressReadinessTimeout();
        Duration interval = startProperties.start().egressPollInterval();
        long deadline = System.nanoTime() + timeout.toNanos();
        while (true) {
            LiveRecordingControl.EgressReadiness readiness = recordingControl.pollReadiness(sessionId);
            if (readiness.ready()) {
                return null;
            }
            if (readiness.failed()) {
                return readiness.failureCode() != null ? readiness.failureCode() : "EGRESS_FAILED";
            }
            if (System.nanoTime() >= deadline) {
                return "EGRESS_NOT_READY";
            }
            try {
                Thread.sleep(interval.toMillis());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return "EGRESS_NOT_READY";
            }
        }
    }

    /** preflight와 <b>같은</b> 판정 로직을 재사용한다 — 두 곳의 기준이 갈리면 안 된다. */
    private boolean instructorStillConnected(UUID sessionId) {
        return transitions.findInstructorId(sessionId)
                .map(instructorId -> preflightService.check(sessionId, instructorId).ready())
                .orElse(false);
    }

    /**
     * 실패 공통 절차(§6). attempt를 실패로 남기고 세션을 {@code OPEN}으로 되돌린 뒤, 만들어 둔 외부 자원
     * (dispatch·Egress)을 멱등 정리한다. 정리 중 어떤 실패도 삼킨다 — 강사에게 재시도 UI를 보여줄 수
     * 있어야 하므로 세션이 깨지면 안 된다.
     */
    private void failStart(LiveSessionStartingEvent event, String executionOwner,
                           String dispatchId, boolean egressStarted, String code, String message) {
        // stale execution은 새 attempt가 소유한 Egress/Dispatch를 절대 정리하지 않는다.
        if (!transitions.ownsClaim(event.attemptId(), event.sessionId(), executionOwner)) {
            log.info("stale 시작 실패 무시 session={} attempt={} code={}",
                    event.sessionId(), event.attemptId(), code);
            return;
        }
        String ownedDispatchId = dispatchId != null
                ? dispatchId : transitions.findDispatchId(event.attemptId()).orElse(null);
        if (ownedDispatchId != null) {
            agentDispatchControl.deleteDispatch(event.roomName(), ownedDispatchId);
            transitions.markAgentDeleted(event.attemptId(), code);
        }
        if (egressStarted) {
            recordingControl.abortRecording(event.sessionId(), code);
        }
        try {
            // 외부 자원을 먼저 정리한 뒤 OPEN으로 되돌린다. OPEN이 먼저 보이면 새 attempt가 시작돼
            // 이전 cleanup이 새 Egress를 중지할 수 있다.
            transitions.markFailed(event.attemptId(), event.sessionId(), executionOwner, code, message);
        } catch (RuntimeException e) {
            log.error("시작 실패 기록 실패 session={} code={}: {}", event.sessionId(), code, e.getMessage());
        }
        log.warn("라이브 시작 실패 session={} code={} reason={}", event.sessionId(), code, message);
    }

    /** {@code 202 Accepted} 본문 — 서버가 만든 오퍼레이션 ID와 접수 시점의 세션 상태. */
    public record StartOperation(UUID operationId, UUID sessionId, String status) {
    }

    /** 시작 상태 폴링 응답 — attempt 진행 상태와 최신 세션 뷰. */
    public record StartStatus(UUID operationId, String attemptStatus, String step,
                              String failureCode, String failureMessage,
                              LiveSessionView session) {
    }
}
