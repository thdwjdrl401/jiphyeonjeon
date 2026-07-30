package com.liveclass.live;

import com.liveclass.live.api.LiveRecordingControl;
import com.liveclass.live.api.LiveSessionStartingEvent;
import com.liveclass.live.config.LiveKitProperties;
import com.liveclass.live.config.LiveStartProperties;
import com.liveclass.live.repository.LiveStartAttemptRepository;
import com.liveclass.live.service.AgentDispatchControl;
import com.liveclass.live.service.LivePreflightService;
import com.liveclass.live.service.LiveSessionService;
import com.liveclass.live.service.LiveStartOrchestrator;
import com.liveclass.live.service.LiveStartTransitions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * ADR-0002 §5-1의 단계적 rollout 안전장치. Phase 4b 배포 전에 플래그를 false로 잘못 전환해도
 * 실제 readiness 검증을 조용히 건너뛰어 LIVE로 가면 안 된다.
 */
@ExtendWith(MockitoExtension.class)
class LiveStartReadinessFlagTest {

    @Mock
    private LiveStartAttemptRepository attemptRepository;
    @Mock
    private LiveStartTransitions transitions;
    @Mock
    private LiveSessionService liveSessionService;
    @Mock
    private LivePreflightService preflightService;
    @Mock
    private AgentDispatchControl agentDispatchControl;
    @Mock
    private LiveRecordingControl recordingControl;

    @Test
    void assume_ready_false_fails_closed_before_dispatch_and_egress_until_phase_4b_exists() {
        UUID sessionId = UUID.randomUUID();
        UUID lessonId = UUID.randomUUID();
        UUID attemptId = UUID.randomUUID();
        LiveSessionStartingEvent event = new LiveSessionStartingEvent(
                sessionId, lessonId, "session-" + sessionId, attemptId,
                "start-" + UUID.randomUUID(), true, true);
        LiveStartProperties properties = new LiveStartProperties(
                new LiveStartProperties.Stt(false),
                new LiveStartProperties.Start(
                        Duration.ofSeconds(45), Duration.ofSeconds(1), Duration.ofSeconds(90)));
        LiveStartOrchestrator orchestrator = new LiveStartOrchestrator(
                attemptRepository,
                transitions,
                liveSessionService,
                preflightService,
                agentDispatchControl,
                recordingControl,
                new LiveKitProperties(
                        "ws://localhost:7880", "http://localhost:7880",
                        "devkey", "secret", 3600, "stt-agent", 600, 900),
                properties);

        when(transitions.claim(eq(attemptId), anyString(), eq(Duration.ofSeconds(90))))
                .thenReturn(Optional.of(event));
        when(transitions.ownsClaim(eq(attemptId), eq(sessionId), anyString())).thenReturn(true);
        when(transitions.findDispatchId(attemptId)).thenReturn(Optional.empty());

        orchestrator.runStartGates(event);

        verify(agentDispatchControl, never()).ensureDispatch(anyString(), anyString(), anyString());
        verify(recordingControl, never()).startRecording(eq(sessionId), eq(lessonId), anyString());
        verify(transitions).markFailed(
                eq(attemptId), eq(sessionId), anyString(),
                eq("STT_READINESS_GATE_UNAVAILABLE"), anyString());
    }
}
