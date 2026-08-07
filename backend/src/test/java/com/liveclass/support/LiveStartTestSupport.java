package com.liveclass.support;

import com.liveclass.live.api.LiveRecordingControl;
import com.liveclass.live.domain.LiveSession;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.repository.LiveSessionRepository;
import com.liveclass.live.service.AgentDispatchControl;
import com.liveclass.live.service.LiveParticipantIdentity;
import com.liveclass.live.service.LiveRoomControl;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * 라이브 시작 게이트(ADR-0002 §4·§7)를 통과시키는 목 스텁 모음.
 *
 * <p>{@code /start}는 이제 202만 돌려주고 실제 LIVE 전환은 게이트가 결정한다. LIVE 이후 동작을 검증하는
 * 테스트들은 시작 오케스트레이션 자체가 관심사가 아니므로, 여기서 "강사가 마이크를 켜고 방에 있고 Egress가
 * 준비됐다"는 정상 상태를 한 줄로 세팅한다. 게이트 실행 자체는 각 테스트가
 * {@code LiveStartOrchestrator.runStartGates(sessionId)}로 <b>동기</b> 호출한다 — 운영에서는 비동기지만
 * 테스트에서 스레드 타이밍에 의존하면 플래키해진다.
 */
public final class LiveStartTestSupport {

    private LiveStartTestSupport() {
    }

    /** Gate S3① 통과 — 소유 강사가 방에 있고 마이크를 unmuted로 publish 중인 상태. */
    public static void stubInstructorPublishing(LiveRoomControl roomControl, String sessionId, String instructorId) {
        when(roomControl.ensureRoom(anyString())).thenReturn("RM_" + sessionId);
        String identity = LiveParticipantIdentity.of(UUID.fromString(sessionId), UUID.fromString(instructorId));
        when(roomControl.listParticipantMediaStates(anyString()))
                .thenReturn(List.of(new LiveRoomControl.ParticipantMediaState(identity, "ACTIVE", true, false)));
    }

    /**
     * 강사는 방에 있는데 마이크가 없는 상태.
     *
     * <p>ADR-0099 이후 <b>이것은 시작을 막지 않는다</b> — 소리 없이 송출될 뿐이다.
     */
    public static void stubInstructorPresentWithoutMicrophone(
            LiveRoomControl roomControl, String sessionId, String instructorId) {
        when(roomControl.ensureRoom(anyString())).thenReturn("RM_" + sessionId);
        String identity = LiveParticipantIdentity.of(UUID.fromString(sessionId), UUID.fromString(instructorId));
        when(roomControl.listParticipantMediaStates(anyString()))
                .thenReturn(List.of(new LiveRoomControl.ParticipantMediaState(identity, "ACTIVE", false, false)));
    }

    /** 강사가 아직(또는 더 이상) 방에 없는 상태 — Gate S3① 실패. 빈 방이 LIVE가 되면 안 된다. */
    public static void stubEmptyRoom(LiveRoomControl roomControl, String sessionId) {
        when(roomControl.ensureRoom(anyString())).thenReturn("RM_" + sessionId);
        when(roomControl.listParticipantMediaStates(anyString())).thenReturn(List.of());
    }

    /** /start 직전 preflight는 통과하지만 Egress 대기 뒤 Gate S3①에서는 강사가 사라진 상태. */
    public static void stubInstructorDisconnectsAfterPreflight(
            LiveRoomControl roomControl, String sessionId, String instructorId) {
        when(roomControl.ensureRoom(anyString())).thenReturn("RM_" + sessionId);
        String identity = LiveParticipantIdentity.of(UUID.fromString(sessionId), UUID.fromString(instructorId));
        when(roomControl.listParticipantMediaStates(anyString()))
                .thenReturn(
                        List.of(new LiveRoomControl.ParticipantMediaState(identity, "ACTIVE", true, false)),
                        List.of());
    }

    /** Egress Gate A~C 통과 — 시작이 수락되고 곧바로 ACTIVE + manifest 준비 완료. */
    public static void stubRecordingReady(LiveRecordingControl recordingControl) {
        when(recordingControl.startRecording(any(), any(), anyString())).thenReturn(true);
        when(recordingControl.pollReadiness(any()))
                .thenReturn(new LiveRecordingControl.EgressReadiness(true, true, false, null));
    }

    /** Phase 4a 통과 — explicit named Dispatch 생성·ID 영속은 readiness 우회 중에도 필수다. */
    public static void stubAgentDispatched(AgentDispatchControl agentDispatchControl) {
        when(agentDispatchControl.ensureDispatch(anyString(), anyString(), anyString()))
                .thenReturn(Optional.of("AD_test"));
    }

    /**
     * 실커밋(비-{@code @Transactional}) 테스트용 — 커밋 후 {@code @Async} 게이트가 LIVE를 확정할 때까지 기다린다.
     * 이런 테스트에서는 리스너가 실제로 돌기 때문에 게이트를 직접 부르면 두 실행이 경합한다.
     */
    public static void awaitLive(LiveSessionRepository liveSessionRepository, String sessionId) {
        UUID id = UUID.fromString(sessionId);
        long deadline = System.nanoTime() + Duration.ofSeconds(20).toNanos();
        while (System.nanoTime() < deadline) {
            LiveSessionStatus status = liveSessionRepository.findById(id)
                    .map(LiveSession::getStatus)
                    .orElse(null);
            if (status == LiveSessionStatus.LIVE) {
                return;
            }
            if (status != LiveSessionStatus.STARTING) {
                throw new AssertionError("시작 게이트가 LIVE로 가지 못했습니다: status=" + status);
            }
            sleep();
        }
        throw new AssertionError("시작 게이트가 제한 시간 안에 LIVE로 가지 못했습니다: session=" + sessionId);
    }

    private static void sleep() {
        try {
            Thread.sleep(50);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError("LIVE 대기 중 인터럽트", e);
        }
    }
}
