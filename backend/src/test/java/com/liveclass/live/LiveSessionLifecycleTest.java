package com.liveclass.live;

import com.liveclass.live.api.LiveRecordingControl;
import com.liveclass.live.domain.LiveAgentJobStatus;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.domain.LiveStartAttemptStatus;
import com.liveclass.live.repository.LiveAgentJobRepository;
import com.liveclass.live.repository.LiveSessionRepository;
import com.liveclass.live.repository.LiveStartAttemptRepository;
import com.liveclass.live.service.AgentDispatchControl;
import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.live.service.LiveRoomControlException;
import com.liveclass.live.service.LiveStartOrchestrator;
import com.liveclass.live.service.LiveStartTransitions;
import com.liveclass.support.LiveStartTestSupport;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 라이브 시작/종료 상태 전이 + 멱등성 검증(ADR-0002). 세션 강사만 할 수 있다.
 *
 * <p>{@code /start}는 202 STARTING만 돌려주고 LIVE 전환은 게이트가 결정하므로, 게이트를 여기서 동기로
 * 돌려(운영에서는 커밋 후 비동기) 성공·실패 경로를 모두 확인한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LiveSessionLifecycleTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private LiveStartOrchestrator startOrchestrator;

    @Autowired
    private LiveStartTransitions transitions;

    @Autowired
    private LiveStartAttemptRepository attemptRepository;

    @Autowired
    private LiveAgentJobRepository agentJobRepository;

    @Autowired
    private LiveSessionRepository liveSessionRepository;

    // 실제 LiveKit 방 제어(방 준비·참가자 조회·방 닫기)를 목으로 대체 — 테스트가 실 서버에 붙지 않게.
    @MockitoBean
    private LiveRoomControl roomControl;

    // Egress는 별도 트랜잭션(REQUIRES_NEW)이라 이 @Transactional 테스트의 미커밋 세션을 볼 수 없다.
    // 시작 게이트의 상태기계만 보는 테스트이므로 포트 자체를 목으로 둔다(실경로는 RecordingLifecycleTest).
    @MockitoBean
    private LiveRecordingControl recordingControl;

    @MockitoBean
    private AgentDispatchControl agentDispatchControl;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @BeforeEach
    void stubDispatch() {
        LiveStartTestSupport.stubAgentDispatched(agentDispatchControl);
    }

    @Test
    void start_is_accepted_and_gates_promote_to_live() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        readyGates(ids);

        write(post("/api/live-sessions/" + ids[0] + "/start"), instructor, null)
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("STARTING"))
                .andExpect(jsonPath("$.operationId").isNotEmpty());

        startOrchestrator.runStartGates(UUID.fromString(ids[0]));

        mockMvc.perform(get("/api/live-sessions/" + ids[0]).cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveSessionStatus").value("LIVE"))
                .andExpect(jsonPath("$.startedAt").isNotEmpty());

        var attempt = attemptRepository
                .findFirstByLiveSessionIdOrderByCreatedAtDesc(UUID.fromString(ids[0]))
                .orElseThrow();
        var agentJob = agentJobRepository.findByLiveStartAttemptId(attempt.getId()).orElseThrow();
        assertThat(agentJob.getDispatchId()).isEqualTo("AD_test");
        assertThat(agentJob.getStatus()).isEqualTo(LiveAgentJobStatus.ASSUMED_RUNNING);

        ArgumentCaptor<String> metadata = ArgumentCaptor.forClass(String.class);
        verify(agentDispatchControl).ensureDispatch(
                eq("session-" + ids[0]), anyString(), metadata.capture());
        assertThat(metadata.getValue()).isEqualTo("""
                {"contractVersion":"1","sessionId":"%s","lessonId":"%s","correlationId":"%s"}\
                """.formatted(ids[0], ids[1], attempt.getCorrelationId()));
    }

    @Test
    void preflight_contract_prepares_room_and_reports_actual_microphone() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        LiveStartTestSupport.stubInstructorPublishing(roomControl, ids[0], ids[2]);

        write(post("/api/instructor/live-sessions/" + ids[0] + "/preflight"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionId").value(ids[0]))
                .andExpect(jsonPath("$.roomName").value("session-" + ids[0]))
                .andExpect(jsonPath("$.roomSid").value("RM_" + ids[0]));

        mockMvc.perform(get("/api/instructor/live-sessions/" + ids[0] + "/preflight/readiness")
                        .cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ready").value(true))
                .andExpect(jsonPath("$.instructorPresent").value(true))
                .andExpect(jsonPath("$.microphonePublished").value(true))
                .andExpect(jsonPath("$.microphoneMuted").value(false))
                .andExpect(jsonPath("$.instructorMicrophoneTrackCount").value(1))
                .andExpect(jsonPath("$.unexpectedMicrophonePublishers").value(0));
    }

    @Test
    void start_rejects_before_attempt_when_instructor_is_not_in_the_room() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        LiveStartTestSupport.stubEmptyRoom(roomControl, ids[0]);

        write(post("/api/live-sessions/" + ids[0] + "/start"), instructor, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_STATE_CONFLICT"));

        assertThat(attemptRepository
                .findFirstByLiveSessionIdOrderByCreatedAtDesc(UUID.fromString(ids[0]))).isEmpty();
        verify(agentDispatchControl, never()).ensureDispatch(anyString(), anyString(), anyString());
        verify(recordingControl, never()).startRecording(any(), any(), anyString());
    }

    /**
     * ADR-0099. 마이크가 없다고 강의를 못 열 이유는 없다 — Egress는 트랙을 믹스하지 않고 헤드리스
     * Chrome의 재생 출력을 담으므로(ADR-0048), 오디오가 없으면 실패가 아니라 무음이다.
     */
    @Test
    void start_is_allowed_without_a_microphone_and_readiness_says_so() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        LiveStartTestSupport.stubInstructorPresentWithoutMicrophone(roomControl, ids[0], ids[2]);
        LiveStartTestSupport.stubRecordingReady(recordingControl);

        // 점검은 통과한다 — 다만 마이크가 없다는 사실을 그대로 내려 화면이 강사에게 알릴 수 있게 한다.
        mockMvc.perform(get("/api/instructor/live-sessions/" + ids[0] + "/preflight/readiness")
                        .cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ready").value(true))
                .andExpect(jsonPath("$.instructorPresent").value(true))
                .andExpect(jsonPath("$.microphonePublished").value(false))
                .andExpect(jsonPath("$.instructorMicrophoneTrackCount").value(0));

        startAndRunGates(instructor, ids[0]);

        mockMvc.perform(get("/api/live-sessions/" + ids[0]).cookie(instructor))
                .andExpect(jsonPath("$.liveSessionStatus").value("LIVE"));
    }

    @Test
    void preflight_livekit_lookup_failure_is_502_not_a_false_microphone_conflict() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        doThrow(new LiveRoomControlException("LiveKit unavailable", null))
                .when(roomControl).listParticipantMediaStates("session-" + ids[0]);

        mockMvc.perform(get("/api/instructor/live-sessions/" + ids[0] + "/preflight/readiness")
                        .cookie(instructor))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("LIVE_ROOM_CONTROL_FAILED"));
    }

    @Test
    void dispatch_failure_blocks_egress_and_returns_session_to_open() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        LiveStartTestSupport.stubInstructorPublishing(roomControl, ids[0], ids[2]);
        when(agentDispatchControl.ensureDispatch(anyString(), anyString(), anyString()))
                .thenReturn(Optional.empty());

        write(post("/api/live-sessions/" + ids[0] + "/start"), instructor, null)
                .andExpect(status().isAccepted());
        startOrchestrator.runStartGates(UUID.fromString(ids[0]));

        mockMvc.perform(get("/api/live-sessions/" + ids[0] + "/start-status").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attemptStatus").value("FAILED"))
                .andExpect(jsonPath("$.failureCode").value("STT_DISPATCH_FAILED"))
                .andExpect(jsonPath("$.session.liveSessionStatus").value("OPEN"));
        verify(recordingControl, never()).startRecording(any(), any(), anyString());
    }

    @Test
    void start_reuses_the_active_attempt_while_starting() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        readyGates(ids);

        String first = json(write(post("/api/live-sessions/" + ids[0] + "/start"), instructor, null)
                .andExpect(status().isAccepted()).andReturn()).get("operationId").asString();
        // 재클릭은 새 attempt를 만들지 않고 같은 오퍼레이션을 돌려준다(§2).
        write(post("/api/live-sessions/" + ids[0] + "/start"), instructor, null)
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("STARTING"))
                .andExpect(jsonPath("$.operationId").value(first));
    }

    @Test
    void start_is_idempotent_after_live() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        readyGates(ids);
        startAndRunGates(instructor, ids[0]);

        write(post("/api/live-sessions/" + ids[0] + "/start"), instructor, null)
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("LIVE"));
    }

    @Test
    void start_status_reports_success() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        readyGates(ids);
        startAndRunGates(instructor, ids[0]);

        mockMvc.perform(get("/api/live-sessions/" + ids[0] + "/start-status").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attemptStatus").value("SUCCEEDED"))
                .andExpect(jsonPath("$.session.liveSessionStatus").value("LIVE"));
    }

    @Test
    void egress_failure_returns_the_session_to_open_and_records_the_failure() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        LiveStartTestSupport.stubInstructorPublishing(roomControl, ids[0], ids[2]);
        when(recordingControl.startRecording(any(), any(), anyString())).thenReturn(false);

        write(post("/api/live-sessions/" + ids[0] + "/start"), instructor, null).andExpect(status().isAccepted());
        startOrchestrator.runStartGates(UUID.fromString(ids[0]));

        mockMvc.perform(get("/api/live-sessions/" + ids[0] + "/start-status").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attemptStatus").value("FAILED"))
                .andExpect(jsonPath("$.failureCode").value("EGRESS_START_FAILED"))
                // 일시적 실패로 세션을 terminal FAILED로 만들지 않는다 — 강사가 다시 시작할 수 있어야 한다(§6).
                .andExpect(jsonPath("$.session.liveSessionStatus").value("OPEN"));
        // 명시적인 API 거절은 RecordingService가 이미 FAILED로 확정한다. 원격 Egress가 생겼다는
        // 증거가 없으므로 세션 기준 abort를 추가 호출하지 않는다.
        verify(recordingControl, never()).abortRecording(any(), anyString());
    }

    @Test
    void instructor_who_left_the_room_does_not_go_live() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        LiveStartTestSupport.stubInstructorDisconnectsAfterPreflight(roomControl, ids[0], ids[2]);
        LiveStartTestSupport.stubRecordingReady(recordingControl);

        write(post("/api/live-sessions/" + ids[0] + "/start"), instructor, null).andExpect(status().isAccepted());
        startOrchestrator.runStartGates(UUID.fromString(ids[0]));

        // Gate S3① — 빈 방이 LIVE로 노출되지 않는다(§7). Egress도 되돌린다.
        mockMvc.perform(get("/api/live-sessions/" + ids[0] + "/start-status").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attemptStatus").value("FAILED"))
                .andExpect(jsonPath("$.failureCode").value("INSTRUCTOR_NOT_PUBLISHING"))
                .andExpect(jsonPath("$.session.liveSessionStatus").value("OPEN"));
        verify(recordingControl).abortRecording(UUID.fromString(ids[0]), "INSTRUCTOR_NOT_PUBLISHING");
    }

    @Test
    void failed_start_can_be_retried() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        LiveStartTestSupport.stubInstructorDisconnectsAfterPreflight(roomControl, ids[0], ids[2]);
        LiveStartTestSupport.stubRecordingReady(recordingControl);
        write(post("/api/live-sessions/" + ids[0] + "/start"), instructor, null).andExpect(status().isAccepted());
        startOrchestrator.runStartGates(UUID.fromString(ids[0]));

        // 강사가 다시 들어와 시작 → 새 attempt가 만들어지고 이번엔 LIVE가 된다.
        LiveStartTestSupport.stubInstructorPublishing(roomControl, ids[0], ids[2]);
        startAndRunGates(instructor, ids[0]);

        mockMvc.perform(get("/api/live-sessions/" + ids[0]).cookie(instructor))
                .andExpect(jsonPath("$.liveSessionStatus").value("LIVE"));
    }

    @Test
    void stale_execution_cannot_promote_or_fail_a_reclaimed_attempt() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        LiveStartTestSupport.stubInstructorPublishing(roomControl, ids[0], ids[2]);

        write(post("/api/live-sessions/" + ids[0] + "/start"), instructor, null)
                .andExpect(status().isAccepted());
        var attempt = attemptRepository
                .findFirstByLiveSessionIdOrderByCreatedAtDesc(UUID.fromString(ids[0]))
                .orElseThrow();
        var oldEvent = transitions.claim(attempt.getId(), "old-owner", java.time.Duration.ofMinutes(1))
                .orElseThrow();

        // lease 만료 뒤 새 실행기가 같은 attempt를 인계받은 상황을 만든다.
        attempt.setLeaseUntil(java.time.OffsetDateTime.now().minusSeconds(1));
        var currentEvent = transitions.claim(attempt.getId(), "current-owner", java.time.Duration.ofMinutes(1))
                .orElseThrow();

        transitions.promoteToLive(oldEvent, "old-owner");
        transitions.markFailed(attempt.getId(), UUID.fromString(ids[0]), "old-owner",
                "STALE_FAILURE", "늦게 도착한 이전 실행");

        assertThat(liveSessionRepository.findById(UUID.fromString(ids[0])).orElseThrow().getStatus())
                .isEqualTo(LiveSessionStatus.STARTING);
        assertThat(attemptRepository.findById(attempt.getId()).orElseThrow().getStatus())
                .isEqualTo(LiveStartAttemptStatus.IN_PROGRESS);
        assertThat(currentEvent.attemptId()).isEqualTo(attempt.getId());
        assertThat(attemptRepository.findById(attempt.getId()).orElseThrow().getLeaseOwner())
                .isEqualTo("current-owner");
    }

    @Test
    void end_moves_to_ended_and_is_idempotent() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        readyGates(ids);
        startAndRunGates(instructor, ids[0]);

        write(post("/api/live-sessions/" + ids[0] + "/end"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveSessionStatus").value("ENDED"));

        InOrder order = inOrder(roomControl, recordingControl);
        order.verify(roomControl).closeRoom("session-" + ids[0]);
        order.verify(recordingControl).stopRecording(UUID.fromString(ids[0]));

        // 두 번째 종료도 성공(멱등).
        write(post("/api/live-sessions/" + ids[0] + "/end"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveSessionStatus").value("ENDED"));
        verify(roomControl).closeRoom("session-" + ids[0]);
        verify(recordingControl).stopRecording(UUID.fromString(ids[0]));
    }

    @Test
    void room_close_failure_returns_502_and_leaves_the_session_ending() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        readyGates(ids);
        startAndRunGates(instructor, ids[0]);
        doThrow(new LiveRoomControlException("delete failed", null))
                .when(roomControl).closeRoom("session-" + ids[0]);

        write(post("/api/live-sessions/" + ids[0] + "/end"), instructor, null)
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("LIVE_ROOM_CONTROL_FAILED"));

        assertThat(liveSessionRepository.findById(UUID.fromString(ids[0])).orElseThrow().getStatus())
                .isEqualTo(LiveSessionStatus.ENDING);
        verify(recordingControl, never()).stopRecording(any());
    }

    @Test
    void egress_stop_failure_does_not_block_ended() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        readyGates(ids);
        startAndRunGates(instructor, ids[0]);
        doThrow(new IllegalStateException("egress failed"))
                .when(recordingControl).stopRecording(UUID.fromString(ids[0]));

        write(post("/api/live-sessions/" + ids[0] + "/end"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveSessionStatus").value("ENDED"));
    }

    @Test
    void ending_a_not_started_session_returns_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);

        write(post("/api/live-sessions/" + ids[0] + "/end"), instructor, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_STATE_CONFLICT"));
    }

    @Test
    void restarting_an_ended_session_returns_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        readyGates(ids);
        startAndRunGates(instructor, ids[0]);
        write(post("/api/live-sessions/" + ids[0] + "/end"), instructor, null).andExpect(status().isOk());

        write(post("/api/live-sessions/" + ids[0] + "/start"), instructor, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_STATE_CONFLICT"));
    }

    @Test
    void non_instructor_cannot_start_returns_403() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);

        Cookie[] student = loginAs("STUDENT");
        write(post("/api/live-sessions/" + ids[0] + "/start"), student, null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_FORBIDDEN"));
        verify(roomControl, never()).ensureRoom(anyString());
    }

    // ---- 헬퍼 ----

    private void readyGates(String[] ids) {
        LiveStartTestSupport.stubInstructorPublishing(roomControl, ids[0], ids[2]);
        LiveStartTestSupport.stubRecordingReady(recordingControl);
    }

    private void startAndRunGates(Cookie[] auth, String sessionId) throws Exception {
        write(post("/api/live-sessions/" + sessionId + "/start"), auth, null).andExpect(status().isAccepted());
        startOrchestrator.runStartGates(UUID.fromString(sessionId));
    }

    /** {sessionId, lessonId, instructorId} 반환. */
    private String[] createSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"라이프사이클\"}")
                .andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), auth, "{\"title\":\"섹션\"}")
                .andReturn()).get("sectionId").asString();
        String lid = json(write(post("/api/instructor/sections/" + sid + "/lessons"), auth, "{\"title\":\"레슨\"}")
                .andReturn()).get("lessonId").asString();
        JsonNode session = json(write(post("/api/instructor/lessons/" + lid + "/live-sessions"), auth, null)
                .andReturn());
        return new String[]{session.get("sessionId").asString(), lid, session.get("instructorId").asString()};
    }

    private org.springframework.test.web.servlet.ResultActions write(
            MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body) throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        JsonNode csrfBody = json(csrf);
        Cookie xsrf = csrf.getResponse().getCookie("XSRF-TOKEN");
        List<Cookie> cookies = new ArrayList<>();
        cookies.add(xsrf);
        if (authCookies != null) {
            cookies.addAll(List.of(authCookies));
        }
        builder = builder.cookie(cookies.toArray(new Cookie[0]))
                .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString());
        if (body != null) {
            builder = builder.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(builder);
    }

    private Cookie[] loginAs(String role) throws Exception {
        String email = "lc-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role)).andExpect(status().isCreated());
        MvcResult login = write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn();
        return login.getResponse().getCookies();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
