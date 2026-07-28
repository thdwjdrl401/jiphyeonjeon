package com.liveclass.live;

import com.liveclass.live.api.LiveRecordingControl;
import com.liveclass.live.service.AgentDispatchControl;
import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.live.service.LiveRoomControlException;
import com.liveclass.live.service.LiveStartOrchestrator;
import com.liveclass.support.LiveStartTestSupport;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
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
import java.util.UUID;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 실시간 방 제어(강퇴·참여자 목록) 검증. 실제 LiveKit 호출은 LiveRoomControl 목으로 대체하고,
 * 소유권 검증과 "올바른 방·참여자로 호출하는가"를 확인한다. 실연동은 실 크리덴셜로 수동 검증.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LiveRoomControlTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private LiveRoomControl roomControl;

    @MockitoBean
    private LiveRecordingControl recordingControl;

    @MockitoBean
    private AgentDispatchControl agentDispatchControl;

    @Autowired
    private LiveStartOrchestrator startOrchestrator;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void list_participants_calls_correct_room() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);
        when(roomControl.listParticipants(eq("session-" + sessionId)))
                .thenReturn(List.of(new LiveRoomControl.RoomParticipant("stu-1", "김학생", "ACTIVE", 1_700_000_000L)));

        mockMvc.perform(get("/api/instructor/live-sessions/" + sessionId + "/participants").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].identity").value("stu-1"))
                .andExpect(jsonPath("$[0].state").value("ACTIVE"));

        verify(roomControl).listParticipants("session-" + sessionId);
    }

    @Test
    void remove_participant_calls_livekit_and_returns_204() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);

        write(delete("/api/instructor/live-sessions/" + sessionId + "/participants/stu-9"), instructor, null)
                .andExpect(status().isNoContent());

        verify(roomControl).removeParticipant("session-" + sessionId, "stu-9");
    }

    @Test
    void other_instructor_cannot_remove_returns_403() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String sessionId = createSession(owner);

        Cookie[] intruder = loginAs("INSTRUCTOR");
        write(delete("/api/instructor/live-sessions/" + sessionId + "/participants/stu-9"), intruder, null)
                .andExpect(status().isForbidden());
    }

    @Test
    void livekit_failure_maps_to_502() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);
        doThrow(new LiveRoomControlException("서버 오류", null))
                .when(roomControl).removeParticipant(eq("session-" + sessionId), eq("stu-9"));

        write(delete("/api/instructor/live-sessions/" + sessionId + "/participants/stu-9"), instructor, null)
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("LIVE_ROOM_CONTROL_FAILED"));
    }

    @Test
    void ending_a_live_session_closes_the_room() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);
        // /start는 202만 돌려주므로 게이트를 동기로 돌려 LIVE까지 올린다(운영에서는 커밋 후 비동기).
        String instructorId = json(mockMvc.perform(get("/api/auth/me").cookie(instructor)).andReturn())
                .get("userId").asString();
        LiveStartTestSupport.stubInstructorPublishing(roomControl, sessionId, instructorId);
        LiveStartTestSupport.stubRecordingReady(recordingControl);
        LiveStartTestSupport.stubAgentDispatched(agentDispatchControl);
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isAccepted());
        startOrchestrator.runStartGates(UUID.fromString(sessionId));

        write(post("/api/live-sessions/" + sessionId + "/end"), instructor, null).andExpect(status().isOk());

        verify(roomControl).closeRoom("session-" + sessionId);
    }

    // ---- 헬퍼 ----

    private String createSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"방제어\"}")
                .andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), auth, "{\"title\":\"섹션\"}")
                .andReturn()).get("sectionId").asString();
        String lid = json(write(post("/api/instructor/sections/" + sid + "/lessons"), auth, "{\"title\":\"레슨\"}")
                .andReturn()).get("lessonId").asString();
        return json(write(post("/api/instructor/lessons/" + lid + "/live-sessions"), auth, null)
                .andReturn()).get("sessionId").asString();
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
        String email = "rc-" + UUID.randomUUID() + "@liveclass.test";
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
