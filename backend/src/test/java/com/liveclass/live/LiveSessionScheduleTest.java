package com.liveclass.live;

import com.liveclass.live.service.LiveRoomControl;
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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 라이브 세션 일정 수정·취소 검증. 시작 전에만 가능, 세션 강사만.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LiveSessionScheduleTest {

    @Autowired
    private MockMvc mockMvc;

    // 시작 요청이 실제 LiveKit에 방을 만들지 않게 목으로 대체. 이 테스트는 STARTING만 있으면 충분하다
    // (일정 수정·취소는 시작 전에만 가능하므로 LIVE까지 갈 필요가 없다).
    @MockitoBean
    private LiveRoomControl roomControl;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void update_schedule_before_start() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);

        write(patch("/api/instructor/live-sessions/" + sessionId), instructor, """
                {"scheduledAt":"2026-09-01T20:00:00+09:00","entryWindowMinutes":10,"expectedDurationMinutes":90}
                """)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entryWindowMinutes").value(10))
                .andExpect(jsonPath("$.expectedDurationMinutes").value(90));
    }

    @Test
    void updating_schedule_after_start_returns_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);
        stubPreflight(instructor, sessionId);
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isAccepted());

        write(patch("/api/instructor/live-sessions/" + sessionId), instructor, """
                {"entryWindowMinutes":5}
                """)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_STATE_CONFLICT"));
    }

    @Test
    void cancel_before_start() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);

        write(post("/api/instructor/live-sessions/" + sessionId + "/cancel"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveSessionStatus").value("CANCELLED"));
    }

    @Test
    void cancel_is_idempotent() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);
        write(post("/api/instructor/live-sessions/" + sessionId + "/cancel"), instructor, null).andExpect(status().isOk());

        write(post("/api/instructor/live-sessions/" + sessionId + "/cancel"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveSessionStatus").value("CANCELLED"));
    }

    @Test
    void cancelling_a_live_session_returns_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);
        stubPreflight(instructor, sessionId);
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isAccepted());

        write(post("/api/instructor/live-sessions/" + sessionId + "/cancel"), instructor, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_STATE_CONFLICT"));
    }

    @Test
    void other_instructor_cannot_cancel_returns_403() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String sessionId = createSession(owner);

        Cookie[] intruder = loginAs("INSTRUCTOR");
        write(post("/api/instructor/live-sessions/" + sessionId + "/cancel"), intruder, null)
                .andExpect(status().isForbidden());
    }

    // ---- 헬퍼 ----

    private void stubPreflight(Cookie[] instructor, String sessionId) throws Exception {
        String instructorId = json(mockMvc.perform(get("/api/auth/me").cookie(instructor)).andReturn())
                .get("userId").asString();
        LiveStartTestSupport.stubInstructorPublishing(roomControl, sessionId, instructorId);
    }

    private String createSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"일정\"}")
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
        String email = "sch-" + UUID.randomUUID() + "@liveclass.test";
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
