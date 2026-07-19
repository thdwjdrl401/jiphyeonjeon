package com.liveclass.video;

import com.liveclass.live.api.LiveSessionStartedEvent;
import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import com.liveclass.video.service.EgressControl;
import com.liveclass.video.service.EgressControlException;
import com.liveclass.video.service.RecordingEventListener;
import com.liveclass.video.service.RecordingService;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
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
    @Autowired private RecordingEventListener recordingEventListener;
    @Autowired private VideoAssetRepository videoAssetRepository;
    @Autowired private ApplicationEvents events;

    @MockitoBean private EgressControl egressControl;
    @MockitoBean private LiveRoomControl roomControl;   // 종료 시 방 닫기가 실 LiveKit을 안 타게 목.

    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    private final List<UUID> createdSessions = new ArrayList<>();

    @AfterEach
    void cleanupVideoAssets() {
        for (UUID sessionId : createdSessions) {
            videoAssetRepository.findByLiveSessionId(sessionId).ifPresent(videoAssetRepository::delete);
        }
        createdSessions.clear();
    }

    @Test
    void starting_a_session_publishes_started_event_with_recording_enabled() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        String sessionId = ids[1];

        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isOk());

        List<LiveSessionStartedEvent> published = events.stream(LiveSessionStartedEvent.class).toList();
        assertThat(published).hasSize(1);
        assertThat(published.get(0).sessionId()).isEqualTo(UUID.fromString(sessionId));
        assertThat(published.get(0).recordingEnabled()).isTrue();
        assertThat(published.get(0).roomName()).isEqualTo("session-" + sessionId);
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
        assertThat(asset.getEgressId()).isEqualTo("eg_test123");
        assertThat(asset.getBucket()).isEqualTo("recordings");
        assertThat(asset.getRecordingStartedAt()).isNotNull();
        verify(egressControl).startHlsRecording("session-" + sessionId, "sessions/" + sessionId);
    }

    @Test
    void egress_failure_marks_asset_failed_but_does_not_throw() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        UUID lessonId = UUID.fromString(ids[0]);
        UUID sessionId = UUID.fromString(ids[1]);
        when(egressControl.startHlsRecording(any(), any())).thenThrow(new EgressControlException("boom"));

        recordingService.startRecording(sessionId, lessonId, "session-" + sessionId);   // 예외 전파 안 함

        VideoAsset asset = videoAssetRepository.findByLiveSessionId(sessionId).orElseThrow();
        assertThat(asset.getStatus()).isEqualTo(VideoAssetStatus.FAILED);
        assertThat(asset.getFailureCode()).isEqualTo("EGRESS_START_FAILED");
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
    void recording_disabled_session_creates_no_asset() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        UUID lessonId = UUID.fromString(ids[0]);
        UUID sessionId = UUID.fromString(ids[1]);

        // 리스너를 직접 호출: recordingEnabled=false면 서비스로 위임하지 않는다.
        recordingEventListener.onSessionStarted(
                new LiveSessionStartedEvent(sessionId, lessonId, "session-" + sessionId, false));

        assertThat(videoAssetRepository.findByLiveSessionId(sessionId)).isEmpty();
    }

    // ---- 헬퍼 (ChatContractTest 패턴) ----

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
