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
 * 라이브 세션 생성·조회 골격 검증. 생성은 curriculum이 소유권 검증 후 live 포트로 위임.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LiveSessionContractTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void create_live_session_returns_201_scheduled() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);

        write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth, """
                {"scheduledAt":"2026-08-01T20:00:00+09:00"}
                """)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.sessionId").exists())
                .andExpect(jsonPath("$.lessonId").value(lessonId))
                .andExpect(jsonPath("$.liveSessionStatus").value("SCHEDULED"))
                .andExpect(jsonPath("$.recordingEnabled").value(true));
    }

    @Test
    void create_without_schedule_is_draft() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);

        write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth, null)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.liveSessionStatus").value("DRAFT"));
    }

    @Test
    void second_session_for_same_lesson_returns_409() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);
        write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth, null)
                .andExpect(status().isCreated());

        write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CURRICULUM_STATE_CONFLICT"));
    }

    @Test
    void other_instructor_cannot_create_session_returns_403() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String lessonId = createLesson(owner);

        Cookie[] intruder = loginAs("INSTRUCTOR");
        write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), intruder, null)
                .andExpect(status().isForbidden());
    }

    @Test
    void get_session_returns_it() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);
        MvcResult created = write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth, null)
                .andReturn();
        String sessionId = json(created).get("sessionId").asString();

        mockMvc.perform(get("/api/live-sessions/" + sessionId).cookie(auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionId").value(sessionId))
                .andExpect(jsonPath("$.lessonId").value(lessonId));
    }

    @Test
    void get_unknown_session_returns_404() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        mockMvc.perform(get("/api/live-sessions/" + UUID.randomUUID()).cookie(auth))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_NOT_FOUND"));
    }

    @Test
    void get_session_without_access_returns_403() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String lessonId = createLesson(owner);
        String sessionId = json(write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), owner, null)
                .andReturn()).get("sessionId").asString();

        Cookie[] outsider = loginAs("STUDENT");   // 소유 강사도, 활성 수강생도 아님
        mockMvc.perform(get("/api/live-sessions/" + sessionId).cookie(outsider))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_FORBIDDEN"));
    }

    // ---- 헬퍼 ----

    private String createLesson(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"라이브 테스트\"}")
                .andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), auth, "{\"title\":\"섹션\"}")
                .andReturn()).get("sectionId").asString();
        return json(write(post("/api/instructor/sections/" + sid + "/lessons"), auth, "{\"title\":\"레슨\"}")
                .andReturn()).get("lessonId").asString();
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
        String email = "live-" + UUID.randomUUID() + "@liveclass.test";
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
