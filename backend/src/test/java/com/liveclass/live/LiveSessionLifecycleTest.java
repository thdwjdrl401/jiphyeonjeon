package com.liveclass.live;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 라이브 시작/종료 상태 전이 + 멱등성 검증. 세션 강사만 할 수 있다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LiveSessionLifecycleTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void start_moves_to_live() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);

        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveSessionStatus").value("LIVE"));
    }

    @Test
    void start_is_idempotent() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);

        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isOk());
        // 두 번째 시작도 실패가 아니라 진행 중(LIVE) 유지.
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveSessionStatus").value("LIVE"));
    }

    @Test
    void end_moves_to_ended_and_is_idempotent() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isOk());

        write(post("/api/live-sessions/" + sessionId + "/end"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveSessionStatus").value("ENDED"));
        // 두 번째 종료도 성공(멱등).
        write(post("/api/live-sessions/" + sessionId + "/end"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveSessionStatus").value("ENDED"));
    }

    @Test
    void ending_a_not_started_session_returns_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);

        write(post("/api/live-sessions/" + sessionId + "/end"), instructor, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_STATE_CONFLICT"));
    }

    @Test
    void restarting_an_ended_session_returns_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isOk());
        write(post("/api/live-sessions/" + sessionId + "/end"), instructor, null).andExpect(status().isOk());

        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_STATE_CONFLICT"));
    }

    @Test
    void non_instructor_cannot_start_returns_403() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);

        Cookie[] student = loginAs("STUDENT");
        write(post("/api/live-sessions/" + sessionId + "/start"), student, null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_FORBIDDEN"));
    }

    // ---- 헬퍼 ----

    private String createSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"라이프사이클\"}")
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
