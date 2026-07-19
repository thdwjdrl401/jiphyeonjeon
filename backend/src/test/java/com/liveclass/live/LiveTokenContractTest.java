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
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * LiveKit 토큰 발급 계약 검증. LiveKit 서버 없이 — 발급된 JWT의 payload를 디코드해
 * 방(room)·권한(video grant)이 역할대로 들어갔는지 확인한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LiveTokenContractTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void instructor_gets_publisher_token() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);

        MvcResult res = write(post("/api/live-sessions/" + sessionId + "/token"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.connectionType").value("LIVEKIT"))
                .andExpect(jsonPath("$.livekitUrl").exists())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.grants.canPublish").value(true))
                .andExpect(jsonPath("$.grants.canSubscribe").value(true))
                .andReturn();

        JsonNode claims = decodeJwtPayload(json(res).get("accessToken").asString());
        JsonNode video = claims.get("video");
        assertThat(video.get("room").asString()).isEqualTo("session-" + sessionId);
        assertThat(video.get("roomJoin").asBoolean()).isTrue();
        assertThat(video.get("canPublish").asBoolean()).isTrue();
        assertThat(video.get("canSubscribe").asBoolean()).isTrue();
    }

    @Test
    void non_instructor_gets_subscribe_only_token() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);

        Cookie[] student = loginAs("STUDENT");
        MvcResult res = write(post("/api/live-sessions/" + sessionId + "/token"), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.grants.canPublish").value(false))
                .andExpect(jsonPath("$.grants.canSubscribe").value(true))
                .andReturn();

        JsonNode video = decodeJwtPayload(json(res).get("accessToken").asString()).get("video");
        assertThat(video.get("room").asString()).isEqualTo("session-" + sessionId);
        assertThat(video.get("canPublish").asBoolean()).isFalse();
        assertThat(video.get("canSubscribe").asBoolean()).isTrue();
    }

    @Test
    void token_for_unknown_session_returns_404() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        write(post("/api/live-sessions/" + UUID.randomUUID() + "/token"), auth, null)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_NOT_FOUND"));
    }

    @Test
    void token_requires_authentication() throws Exception {
        // 세션은 강사가 만들고, 비로그인으로 토큰 요청 → 401.
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);

        Cookie xsrf = fetchXsrf();
        mockMvc.perform(post("/api/live-sessions/" + sessionId + "/token")
                        .cookie(xsrf).header("X-XSRF-TOKEN", xsrfToken))
                .andExpect(status().isUnauthorized());
    }

    // ---- 헬퍼 ----

    private String xsrfToken;

    private Cookie fetchXsrf() throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        xsrfToken = json(csrf).get("token").asString();
        return csrf.getResponse().getCookie("XSRF-TOKEN");
    }

    private JsonNode decodeJwtPayload(String jwt) throws Exception {
        String payload = jwt.split("\\.")[1];
        byte[] decoded = Base64.getUrlDecoder().decode(payload);
        return jsonMapper.readTree(new String(decoded));
    }

    private String createSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"토큰 테스트\"}")
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
        String email = "tok-" + UUID.randomUUID() + "@liveclass.test";
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
