package com.liveclass.video;

import com.liveclass.live.api.LiveSessionStartingEvent;
import com.liveclass.live.service.AgentDispatchControl;
import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.live.service.LiveStartOrchestrator;
import com.liveclass.video.domain.ReplayStatus;
import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.live.repository.LiveSessionRepository;
import com.liveclass.support.LiveStartTestSupport;
import com.liveclass.video.repository.VideoAssetRepository;
import com.liveclass.video.service.EgressControl;
import com.liveclass.video.service.EgressControlException;
import com.liveclass.video.service.EgressStartOutcomeUnknownException;
import com.liveclass.video.service.RecordingOrchestrationService;
import com.liveclass.video.service.RecordingService;
import com.liveclass.video.service.S3RecordingStorage;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 라이브 녹화 생명주기 골격 검증(songjeongki/0020). Egress는 목이라 인프라 없이 상태기계·이벤트 배선을
 * 확인한다: 시작 이벤트 발행 → RECORDING 자산, 종료 → FINALIZING, Egress 실패 → FAILED, 비활성 → 자산 없음.
 *
 * <p>비-@Transactional(실커밋)이다 — RecordingService는 REQUIRES_NEW라 별도 tx에서 커밋된 세션만 보이므로
 * 세션이 실제로 커밋돼야 한다. 생성한 video_asset은 @AfterEach로 정리한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@RecordApplicationEvents
class RecordingLifecycleTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private RecordingService recordingService;
    @Autowired private RecordingOrchestrationService recordingOrchestrationService;
    @Autowired private LiveStartOrchestrator startOrchestrator;
    @Autowired private VideoAssetRepository videoAssetRepository;
    @Autowired private LiveSessionRepository liveSessionRepository;
    @Autowired private ApplicationEvents events;
    @Autowired private JdbcTemplate jdbcTemplate;

    @MockitoBean private EgressControl egressControl;
    @MockitoBean private LiveRoomControl roomControl;   // 방 준비·참가자 조회·방 닫기가 실 LiveKit을 안 타게 목.
    @MockitoBean private AgentDispatchControl agentDispatchControl;
    @MockitoBean private S3RecordingStorage recordingStorage;   // Gate C의 manifest·세그먼트 확인을 목으로.

    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    private final List<UUID> createdSessions = new ArrayList<>();

    @Test
    void video_asset_schema_does_not_allow_the_removed_requested_status() {
        assertThat(List.of(VideoAssetStatus.values()))
                .extracting(VideoAssetStatus::name)
                .doesNotContain("REQUESTED");

        String defaultExpression = jdbcTemplate.queryForObject("""
                SELECT column_default
                FROM information_schema.columns
                WHERE table_schema = 'core'
                  AND table_name = 'video_asset'
                  AND column_name = 'status'
                """, String.class);
        assertThat(defaultExpression).isNull();

        String constraintDefinition = jdbcTemplate.queryForObject("""
                SELECT pg_get_constraintdef(oid)
                FROM pg_constraint
                WHERE conrelid = 'core.video_asset'::regclass
                  AND conname = 'video_asset_status_check'
                """, String.class);
        assertThat(constraintDefinition)
                .contains("STARTING", "RECORDING", "FINALIZING", "VERIFYING", "READY", "FAILED")
                .doesNotContain("REQUESTED");
    }

    @AfterEach
    void cleanupVideoAssets() {
        for (UUID sessionId : createdSessions) {
            videoAssetRepository.findByLiveSessionId(sessionId).ifPresent(videoAssetRepository::delete);
        }
        createdSessions.clear();
    }

    /**
     * 시작 요청은 이제 LIVE가 아니라 STARTING 이벤트를 낸다(ADR-0002 §2) — 게이트가 이 이벤트를 받아
     * 커밋 후 별도 스레드에서 Egress·강사 확인을 진행한다. LIVE 시점의 {@code LiveSessionStartedEvent}는
     * 그 비동기 스레드에서 나가므로 여기서 세지 않는다.
     */
    @Test
    void starting_a_session_publishes_starting_event_with_flags() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        String sessionId = ids[1];

        when(egressControl.startHlsRecording(any(), any())).thenReturn("eg_starting");
        when(egressControl.findState(any())).thenReturn(Optional.of(EgressControl.EgressState.EGRESS_ACTIVE));
        when(recordingStorage.findManifest(any(), any())).thenReturn(Optional.of(LIVE_MANIFEST));
        when(recordingStorage.head(any(), any())).thenReturn(Optional.of(1_024L));
        String instructorId = json(mockMvc.perform(get("/api/auth/me").cookie(instructor)).andReturn())
                .get("userId").asString();
        LiveStartTestSupport.stubInstructorPublishing(roomControl, sessionId, instructorId);
        LiveStartTestSupport.stubAgentDispatched(agentDispatchControl);

        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isAccepted());
        // 비동기 게이트가 끝나야 @AfterEach 정리와 경합하지 않는다.
        LiveStartTestSupport.awaitLive(liveSessionRepository, sessionId);

        List<LiveSessionStartingEvent> published = events.stream(LiveSessionStartingEvent.class).toList();
        assertThat(published).hasSize(1);
        assertThat(published.get(0).sessionId()).isEqualTo(UUID.fromString(sessionId));
        assertThat(published.get(0).recordingEnabled()).isTrue();
        assertThat(published.get(0).captionEnabled()).isTrue();
        assertThat(published.get(0).roomName()).isEqualTo("session-" + sessionId);
        assertThat(published.get(0).correlationId()).matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}");
    }

    @Test
    void recording_start_creates_asset_in_recording_state() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        UUID lessonId = UUID.fromString(ids[0]);
        UUID sessionId = UUID.fromString(ids[1]);
        when(egressControl.startHlsRecording(any(), any())).thenReturn("eg_test123");

        recordingService.startRecording(sessionId, lessonId, "session-" + sessionId);

        VideoAsset asset = videoAssetRepository.findByLiveSessionId(sessionId).orElseThrow();
        assertThat(asset.getStatus()).isEqualTo(VideoAssetStatus.RECORDING);
        // 녹화가 잡히는 순간부터 다시보기는 DRAFT다 — 카탈로그가 이 값을 그대로 노출하므로
        // "녹화 없음(NOT_READY)"과 구분된다.
        assertThat(asset.getReplayStatus()).isEqualTo(ReplayStatus.DRAFT);
        assertThat(asset.getEgressId()).isEqualTo("eg_test123");
        assertThat(asset.getBucket()).isEqualTo("recordings");
        assertThat(asset.getHlsManifestKey()).isEqualTo("sessions/" + sessionId + "/index.m3u8");
        assertThat(asset.getRecordingStartedAt()).isNotNull();
        verify(egressControl).startHlsRecording("session-" + sessionId, "sessions/" + sessionId);
    }

    @Test
    void egress_failure_marks_asset_failed_and_reports_failure() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        UUID lessonId = UUID.fromString(ids[0]);
        UUID sessionId = UUID.fromString(ids[1]);
        when(egressControl.startHlsRecording(any(), any())).thenThrow(new EgressControlException("boom"));

        // 예외를 전파하지 않고 false로 보고한다 — 오케스트레이터가 Gate A 실패로 접는다.
        assertThat(recordingService.startRecording(sessionId, lessonId, "session-" + sessionId)).isFalse();

        VideoAsset asset = videoAssetRepository.findByLiveSessionId(sessionId).orElseThrow();
        assertThat(asset.getStatus()).isEqualTo(VideoAssetStatus.FAILED);
        assertThat(asset.getFailureCode()).isEqualTo("EGRESS_START_FAILED");
    }

    @Test
    void unknown_start_outcome_is_reconciled_without_creating_a_second_egress() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        UUID lessonId = UUID.fromString(ids[0]);
        UUID sessionId = UUID.fromString(ids[1]);
        when(egressControl.startHlsRecording(any(), any()))
                .thenThrow(new EgressStartOutcomeUnknownException("response lost", new java.io.IOException()));

        assertThat(recordingService.startRecording(
                sessionId, lessonId, "session-" + sessionId)).isTrue();
        assertThat(recordingService.startRecording(
                sessionId, lessonId, "session-" + sessionId)).isTrue();

        VideoAsset uncertain = videoAssetRepository.findByLiveSessionId(sessionId).orElseThrow();
        assertThat(uncertain.getStatus()).isEqualTo(VideoAssetStatus.STARTING);
        assertThat(uncertain.getEgressId()).isNull();
        verify(egressControl, times(1)).startHlsRecording(any(), any());

        when(egressControl.findActiveForRoom("session-" + sessionId))
                .thenReturn(Optional.of(new EgressControl.EgressSnapshot(
                        "eg_recovered", EgressControl.EgressState.EGRESS_ACTIVE)));
        when(egressControl.findState("eg_recovered"))
                .thenReturn(Optional.of(EgressControl.EgressState.EGRESS_ACTIVE));
        when(recordingStorage.findManifest(anyString(), anyString())).thenReturn(Optional.of(LIVE_MANIFEST));
        when(recordingStorage.head(anyString(), anyString())).thenReturn(Optional.of(1_024L));

        assertThat(recordingOrchestrationService.pollReadiness(sessionId).ready()).isTrue();
        VideoAsset recovered = videoAssetRepository.findByLiveSessionId(sessionId).orElseThrow();
        assertThat(recovered.getEgressId()).isEqualTo("eg_recovered");
        assertThat(recovered.getStatus()).isEqualTo(VideoAssetStatus.RECORDING);
    }

    @Test
    void stopping_transitions_recording_asset_to_finalizing() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        UUID lessonId = UUID.fromString(ids[0]);
        UUID sessionId = UUID.fromString(ids[1]);
        when(egressControl.startHlsRecording(any(), any())).thenReturn("eg_stop");
        recordingService.startRecording(sessionId, lessonId, "session-" + sessionId);

        recordingService.stopRecording(sessionId);

        VideoAsset asset = videoAssetRepository.findByLiveSessionId(sessionId).orElseThrow();
        assertThat(asset.getStatus()).isEqualTo(VideoAssetStatus.FINALIZING);
        assertThat(asset.getRecordingEndedAt()).isNotNull();
        verify(egressControl).stopRecording("eg_stop");
    }

    @Test
    void recording_start_is_idempotent() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        UUID lessonId = UUID.fromString(ids[0]);
        UUID sessionId = UUID.fromString(ids[1]);
        when(egressControl.startHlsRecording(any(), any())).thenReturn("eg_once");

        recordingService.startRecording(sessionId, lessonId, "session-" + sessionId);
        recordingService.startRecording(sessionId, lessonId, "session-" + sessionId);   // 두 번째는 건너뜀

        assertThat(videoAssetRepository.findByLiveSessionId(sessionId)).isPresent();
        verify(egressControl, times(1)).startHlsRecording(any(), any());
    }

    @Test
    void recording_disabled_session_is_rejected_before_an_attempt_or_egress() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        UUID sessionId = UUID.fromString(ids[1]);

        var session = liveSessionRepository.findById(sessionId).orElseThrow();
        session.setRecordingEnabled(false);
        liveSessionRepository.saveAndFlush(session);

        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null)
                .andExpect(status().isConflict());

        assertThat(videoAssetRepository.findByLiveSessionId(sessionId)).isEmpty();
        verify(egressControl, never()).startHlsRecording(any(), any());
    }

    // ---- 헬퍼 (ChatContractTest 패턴) ----

    /** Gate C가 볼 라이브 재생목록(ENDLIST 없음 + 세그먼트 존재). */
    private static final String LIVE_MANIFEST = """
            #EXTM3U
            #EXT-X-VERSION:3
            #EXT-X-TARGETDURATION:2
            #EXT-X-MEDIA-SEQUENCE:0
            #EXTINF:2.0,
            seg_00000.ts
            """;

    /** 강사로 커리큘럼→섹션→레슨→라이브세션 생성. {lessonId, sessionId} 반환(시작은 안 함). */
    private String[] createSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"녹화\"}")
                .andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), auth, "{\"title\":\"s\"}")
                .andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sid + "/lessons"), auth, "{\"title\":\"l\"}")
                .andReturn()).get("lessonId").asString();
        String sessionId = json(write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth, null)
                .andReturn()).get("sessionId").asString();
        createdSessions.add(UUID.fromString(sessionId));   // @AfterEach 정리 대상
        return new String[]{lessonId, sessionId};
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
        String email = "rec-" + UUID.randomUUID() + "@liveclass.test";
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
